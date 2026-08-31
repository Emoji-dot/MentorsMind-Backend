import { EnrollmentModel, MilestoneProgressModel } from "../models/enrollment.model";
import { LearningPathModel } from "../models/learning-path.model";
import { MilestoneModel } from "../models/milestone.model";
import { CacheService } from "./cache.service";
import { CacheKeys, CacheTTL } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { PaymentsService } from "./payments.service";
import { StripeService } from "./stripe.service";
import { 
  PathEnrollment, 
  CreateEnrollmentData, 
  UpdateEnrollmentStatusData,
  PathEnrollmentRecord 
} from "../models/learning-path.model";
import pool from "../config/database";

export interface EnrollmentAnalytics {
  totalEnrollments: number;
  activeEnrollments: number;
  completedEnrollments: number;
  cancelledEnrollments: number;
  averageCompletionTime: number;
  completionRate: number;
  retentionRate: number;
}

export interface BulkEnrollmentData {
  learningPathId: string;
  studentIds: string[];
  paymentData?: any;
  organizationId?: string;
}

interface VerifiedLearningPathPayment {
  transactionId: string;
  amount: number;
  currency: string;
  provider: "stripe" | "stellar";
  paymentReference: string;
  metadata: Record<string, unknown>;
}

export const EnrollmentService = {
  /**
   * Enroll a student in a learning path
   */
  async enrollStudent(
    learningPathId: string, 
    studentId: string, 
    enrollmentData: CreateEnrollmentData = {}
  ): Promise<PathEnrollment> {
    try {
      // Validate learning path exists and is published
      const learningPath = await LearningPathModel.findById(learningPathId);
      if (!learningPath) {
        throw createError("Learning path not found", 404);
      }

      if (!learningPath.is_published) {
        throw createError("Learning path is not published", 400);
      }

      // Validate student exists and is active
      const { rows: studentRows } = await pool.query(
        `SELECT id, status, role FROM users WHERE id = $1 AND is_active = true`,
        [studentId]
      );

      const student = studentRows[0];
      if (!student) {
        throw createError("Student not found", 404);
      }

      if (student.status === "suspended" || student.status === "banned") {
        throw createError("Student account is not active", 403);
      }

      const price = this.getLearningPathPrice(learningPath);
      const currency = learningPath.currency || "XLM";
      const isFree = learningPath.is_free === true || price <= 0;
      let verifiedPayment: VerifiedLearningPathPayment | null = null;

      // Check if already enrolled
      const existingEnrollment = await EnrollmentModel.findByStudentAndPath(studentId, learningPathId);
      if (existingEnrollment) {
        const paymentReference = this.getPaymentReference(enrollmentData.paymentData);
        if (paymentReference) {
          const existingPurchase = await this.findPurchaseByReference(paymentReference);
          if (
            existingPurchase &&
            existingPurchase.enrollment_id === existingEnrollment.id &&
            existingEnrollment.status !== "cancelled"
          ) {
            return EnrollmentModel.transformToEnrollment(existingEnrollment);
          }
          if (
            existingPurchase &&
            existingPurchase.enrollment_id === existingEnrollment.id &&
            existingEnrollment.status === "cancelled"
          ) {
            verifiedPayment = {
              transactionId: existingPurchase.transaction_id,
              amount: Number(existingPurchase.amount),
              currency: existingPurchase.currency,
              provider: existingPurchase.provider as "stripe" | "stellar",
              paymentReference: existingPurchase.payment_reference,
              metadata: { idempotent: true },
            };
          }
          if (
            existingPurchase &&
            existingPurchase.enrollment_id !== existingEnrollment.id
          ) {
            throw createError("Payment reference has already been used", 409);
          }
        }

        if (existingEnrollment.status === 'cancelled') {
          if (!isFree && !verifiedPayment) {
            verifiedPayment = await this.verifyEnrollmentPayment(
              studentId,
              price,
              currency,
              enrollmentData.paymentData,
            );
          }

          // Allow re-enrollment if previously cancelled
          const reactivated = await EnrollmentModel.updateStatus(existingEnrollment.id, {
            status: 'active'
          });
          
          if (reactivated) {
            if (verifiedPayment) {
              await this.recordLearningPathPurchase(
                learningPathId,
                reactivated.id,
                studentId,
                verifiedPayment,
              );
              await EnrollmentModel.updatePaymentStatus(reactivated.id, "paid", verifiedPayment.amount);
            }

            await this.invalidateEnrollmentCaches(studentId, learningPathId);
            
            logger.info("Student re-enrolled in learning path", {
              pathId: learningPathId,
              studentId,
              enrollmentId: existingEnrollment.id
            });

            return EnrollmentModel.transformToEnrollment(reactivated);
          }
        } else {
          throw createError("Student is already enrolled in this learning path", 409);
        }
      }

      if (!isFree) {
        verifiedPayment = await this.verifyEnrollmentPayment(
          studentId,
          price,
          currency,
          enrollmentData.paymentData,
        );
      }

      // Create new enrollment
      const enrollmentRecord = await EnrollmentModel.create(learningPathId, studentId, enrollmentData);
      let enrollmentForResponse: PathEnrollmentRecord = enrollmentRecord;
      if (verifiedPayment) {
        await this.recordLearningPathPurchase(
          learningPathId,
          enrollmentRecord.id,
          studentId,
          verifiedPayment,
        );
        const paidEnrollment = await EnrollmentModel.updatePaymentStatus(
          enrollmentRecord.id,
          "paid",
          verifiedPayment.amount,
        );
        if (paidEnrollment) {
          enrollmentForResponse = paidEnrollment;
        }
      }
      
      // Initialize milestone progress records for all milestones
      const milestones = await MilestoneModel.findByLearningPathId(learningPathId);
      for (const milestone of milestones) {
        await MilestoneProgressModel.create(enrollmentRecord.id, milestone.id);
      }

      // Update learning path enrolled count (handled by database trigger)
      
      // Invalidate relevant caches
      await this.invalidateEnrollmentCaches(studentId, learningPathId);

      const enrollment = EnrollmentModel.transformToEnrollment(enrollmentForResponse);

      logger.info("Student enrolled in learning path", {
        pathId: learningPathId,
        studentId,
        enrollmentId: enrollment.id,
        pathTitle: learningPath.title
      });

      return enrollment;
    } catch (error) {
      logger.error("Failed to enroll student", {
        learningPathId,
        studentId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  async getPurchaseInfo(learningPathId: string, studentId?: string): Promise<Record<string, unknown>> {
    const learningPath = await LearningPathModel.findById(learningPathId);
    if (!learningPath) {
      throw createError("Learning path not found", 404);
    }

    const price = this.getLearningPathPrice(learningPath);
    const currency = learningPath.currency || "XLM";
    let purchased = false;

    if (studentId) {
      const { rows } = await pool.query(
        `SELECT 1
         FROM learning_path_purchases
         WHERE learning_path_id = $1
           AND student_id = $2
           AND status = 'completed'
         LIMIT 1`,
        [learningPathId, studentId],
      );
      purchased = rows.length > 0;
    }

    return {
      learningPathId,
      price,
      currency,
      isFree: learningPath.is_free === true || price <= 0,
      purchased,
      availablePaymentMethods: ["stripe", "stellar"],
    };
  },

  async startTrial(learningPathId: string, studentId: string): Promise<PathEnrollment> {
    const learningPath = await LearningPathModel.findById(learningPathId);
    if (!learningPath) {
      throw createError("Learning path not found", 404);
    }

    if (!learningPath.is_published) {
      throw createError("Learning path is not published", 400);
    }

    const existingEnrollment = await EnrollmentModel.findByStudentAndPath(studentId, learningPathId);
    if (existingEnrollment) {
      throw createError("Student is already enrolled in this learning path", 409);
    }

    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const enrollmentRecord = await EnrollmentModel.create(learningPathId, studentId, {
      paymentMethod: "trial",
      paymentData: { trialEndsAt: trialEndsAt.toISOString() },
    });

    const { rows } = await pool.query<PathEnrollmentRecord>(
      `UPDATE path_enrollments
       SET is_trial = true,
           trial_ends_at = $2,
           requires_payment_after = $2,
           metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
       WHERE id = $1
       RETURNING *`,
      [
        enrollmentRecord.id,
        trialEndsAt,
        JSON.stringify({ trial: true, trialEndsAt: trialEndsAt.toISOString() }),
      ],
    );

    const milestones = await MilestoneModel.findByLearningPathId(learningPathId);
    for (const milestone of milestones) {
      await MilestoneProgressModel.create(enrollmentRecord.id, milestone.id);
    }

    await this.invalidateEnrollmentCaches(studentId, learningPathId);
    return EnrollmentModel.transformToEnrollment(rows[0]);
  },

  async expireTrials(): Promise<number> {
    const { rowCount } = await pool.query(
      `UPDATE path_enrollments
       SET status = 'paused',
           payment_status = 'pending',
           paused_at = COALESCE(paused_at, CURRENT_TIMESTAMP),
           metadata = COALESCE(metadata, '{}'::jsonb) || '{"trialExpired": true}'::jsonb
       WHERE is_trial = true
         AND trial_ends_at <= CURRENT_TIMESTAMP
         AND payment_status <> 'paid'
         AND status = 'active'`,
    );

    return rowCount ?? 0;
  },

  getLearningPathPrice(learningPath: any): number {
    return Number(learningPath.price ?? learningPath.total_price ?? 0);
  },

  getPaymentReference(paymentData: any): string | null {
    if (!paymentData) return null;
    if (paymentData.paymentIntentId) return `stripe:${paymentData.paymentIntentId}`;
    if (paymentData.stellarTxHash) return `stellar:${paymentData.stellarTxHash}`;
    return null;
  },

  async findPurchaseByReference(reference: string): Promise<any | null> {
    const [provider, paymentReference] = reference.split(":", 2);
    const { rows } = await pool.query(
      `SELECT *
       FROM learning_path_purchases
       WHERE provider = $1
         AND payment_reference = $2
         AND status = 'completed'
       LIMIT 1`,
      [provider, paymentReference],
    );
    return rows[0] || null;
  },

  async verifyEnrollmentPayment(
    studentId: string,
    amount: number,
    currency: string,
    paymentData: any,
  ): Promise<VerifiedLearningPathPayment> {
    if (!paymentData?.paymentIntentId && !paymentData?.stellarTxHash) {
      throw createError("Payment required for this learning path", 402);
    }

    if (paymentData.paymentIntentId) {
      const existingPurchase = await this.findPurchaseByReference(`stripe:${paymentData.paymentIntentId}`);
      if (existingPurchase) {
        throw createError("Payment reference has already been used", 409);
      }

      const stripe = StripeService.ensureClient();
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentData.paymentIntentId);
      if (paymentIntent.status !== "succeeded") {
        throw createError("Payment has not succeeded", 402);
      }

      const paidAmount = Number(paymentIntent.amount_received ?? paymentIntent.amount ?? 0) / 100;
      if (paidAmount < amount) {
        throw createError("Payment amount is less than learning path price", 402);
      }

      if ((paymentIntent.currency || "").toUpperCase() !== currency.toUpperCase()) {
        throw createError("Payment currency does not match learning path currency", 402);
      }

      const transactionId = await this.upsertStripeTransaction(
        studentId,
        paymentData.paymentIntentId,
        paidAmount,
        currency,
        paymentIntent,
      );

      return {
        transactionId,
        amount: paidAmount,
        currency,
        provider: "stripe",
        paymentReference: paymentData.paymentIntentId,
        metadata: { stripePaymentIntentId: paymentData.paymentIntentId },
      };
    }

    const paymentId = paymentData.paymentId || paymentData.transactionId;
    const existingPurchase = await this.findPurchaseByReference(`stellar:${paymentData.stellarTxHash}`);
    if (existingPurchase) {
      throw createError("Payment reference has already been used", 409);
    }

    if (paymentId) {
      const confirmed = await PaymentsService.confirmPayment(paymentId, studentId, paymentData.stellarTxHash);
      return {
        transactionId: confirmed.id,
        amount: Number(confirmed.amount),
        currency: confirmed.currency,
        provider: "stellar",
        paymentReference: paymentData.stellarTxHash,
        metadata: { stellarTxHash: paymentData.stellarTxHash },
      };
    }

    const { rows } = await pool.query(
      `SELECT id, amount, currency
       FROM transactions
       WHERE user_id = $1
         AND stellar_tx_hash = $2
         AND status = 'completed'
         AND type = 'payment'
       LIMIT 1`,
      [studentId, paymentData.stellarTxHash],
    );

    if (!rows[0]) {
      throw createError("Valid Stellar payment transaction not found", 402);
    }

    if (Number(rows[0].amount) < amount || rows[0].currency !== currency) {
      throw createError("Stellar payment does not satisfy the learning path price", 402);
    }

    return {
      transactionId: rows[0].id,
      amount: Number(rows[0].amount),
      currency: rows[0].currency,
      provider: "stellar",
      paymentReference: paymentData.stellarTxHash,
      metadata: { stellarTxHash: paymentData.stellarTxHash },
    };
  },

  async upsertStripeTransaction(
    studentId: string,
    paymentIntentId: string,
    amount: number,
    currency: string,
    paymentIntent: unknown,
  ): Promise<string> {
    const existing = await pool.query(
      `SELECT id
       FROM transactions
       WHERE user_id = $1
         AND metadata->>'paymentIntentId' = $2
       LIMIT 1`,
      [studentId, paymentIntentId],
    );
    if (existing.rows[0]) {
      return existing.rows[0].id;
    }

    const { rows } = await pool.query(
      `INSERT INTO transactions (
         user_id, type, status, amount, currency, description, metadata,
         created_at, updated_at, completed_at
       )
       VALUES ($1, 'payment', 'completed', $2, $3, $4, $5::jsonb, NOW(), NOW(), NOW())
       RETURNING id`,
      [
        studentId,
        amount,
        currency,
        `stripe_payment_intent:${paymentIntentId}`,
        JSON.stringify({ paymentIntentId, paymentIntent }),
      ],
    );

    return rows[0].id;
  },

  async recordLearningPathPurchase(
    learningPathId: string,
    enrollmentId: string,
    studentId: string,
    payment: VerifiedLearningPathPayment,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO learning_path_purchases (
         learning_path_id, enrollment_id, student_id, transaction_id,
         amount, currency, provider, payment_reference, status, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9::jsonb)
       ON CONFLICT (provider, payment_reference)
       DO UPDATE SET
         enrollment_id = EXCLUDED.enrollment_id,
         updated_at = CURRENT_TIMESTAMP
       WHERE learning_path_purchases.enrollment_id = EXCLUDED.enrollment_id`,
      [
        learningPathId,
        enrollmentId,
        studentId,
        payment.transactionId,
        payment.amount,
        payment.currency,
        payment.provider,
        payment.paymentReference,
        JSON.stringify(payment.metadata),
      ],
    );
  },

  /**
   * Unenroll a student from a learning path
   */
  async unenrollStudent(learningPathId: string, studentId: string, reason?: string): Promise<void> {
    try {
      const enrollment = await EnrollmentModel.findByStudentAndPath(studentId, learningPathId);
      if (!enrollment) {
        throw createError("Enrollment not found", 404);
      }

      if (enrollment.status === 'cancelled') {
        throw createError("Student is already unenrolled", 400);
      }

      // Update enrollment status to cancelled
      await EnrollmentModel.updateStatus(enrollment.id, {
        status: 'cancelled',
        reason: reason || 'Student unenrolled'
      });

      // Invalidate caches
      await this.invalidateEnrollmentCaches(studentId, learningPathId);

      logger.info("Student unenrolled from learning path", {
        pathId: learningPathId,
        studentId,
        enrollmentId: enrollment.id,
        reason
      });
    } catch (error) {
      logger.error("Failed to unenroll student", {
        learningPathId,
        studentId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get student's enrollments with optional filters
   */
  async getStudentEnrollments(
    studentId: string,
    filters?: {
      status?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<{ enrollments: PathEnrollment[]; total: number }> {
    try {
      const cacheKey = CacheKeys.studentEnrollments(studentId);
      
      // Use cache for simple queries without filters
      if (!filters?.status && !filters?.page) {
        const cached = await CacheService.get<{ enrollments: PathEnrollment[]; total: number }>(cacheKey);
        if (cached) {
          logger.debug("Student enrollments cache hit", { studentId });
          return cached;
        }
      }

      const result = await EnrollmentModel.findByStudentId(studentId, filters);
      const enrollments = result.enrollments.map(e => EnrollmentModel.transformToEnrollment(e));

      const response = { enrollments, total: result.total };

      // Cache simple queries
      if (!filters?.status && !filters?.page) {
        await CacheService.set(cacheKey, response, CacheTTL.short);
      }

      return response;
    } catch (error) {
      logger.error("Failed to get student enrollments", {
        studentId,
        filters,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get enrollments for a learning path (mentor access)
   */
  async getPathEnrollments(
    pathId: string,
    mentorId: string,
    filters?: {
      status?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<{ enrollments: PathEnrollment[]; total: number }> {
    try {
      // Verify mentor owns this path
      const learningPath = await LearningPathModel.findById(pathId);
      if (!learningPath || learningPath.mentor_id !== mentorId) {
        throw createError("Access denied", 403);
      }

      const cacheKey = CacheKeys.pathEnrollments(pathId);
      
      // Use cache for simple queries
      if (!filters?.status && !filters?.page) {
        const cached = await CacheService.get<{ enrollments: PathEnrollment[]; total: number }>(cacheKey);
        if (cached) {
          logger.debug("Path enrollments cache hit", { pathId });
          return cached;
        }
      }

      const result = await EnrollmentModel.findByLearningPathId(pathId, filters);
      const enrollments = result.enrollments.map(e => EnrollmentModel.transformToEnrollment(e));

      const response = { enrollments, total: result.total };

      // Cache simple queries
      if (!filters?.status && !filters?.page) {
        await CacheService.set(cacheKey, response, CacheTTL.short);
      }

      return response;
    } catch (error) {
      logger.error("Failed to get path enrollments", {
        pathId,
        mentorId,
        filters,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Update enrollment status (pause/resume/complete/cancel)
   */
  async updateEnrollmentStatus(
    enrollmentId: string,
    studentId: string,
    statusData: UpdateEnrollmentStatusData
  ): Promise<PathEnrollment> {
    try {
      // Verify enrollment exists and belongs to student
      const enrollment = await EnrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw createError("Enrollment not found", 404);
      }

      if (enrollment.student_id !== studentId) {
        throw createError("Access denied", 403);
      }

      // Validate status transition
      const validTransitions: Record<string, string[]> = {
        'active': ['paused', 'completed', 'cancelled'],
        'paused': ['active', 'cancelled'],
        'completed': [], // Cannot change from completed
        'cancelled': ['active'] // Can re-activate cancelled enrollments
      };

      const allowedStatuses = validTransitions[enrollment.status] || [];
      if (!allowedStatuses.includes(statusData.status)) {
        throw createError(`Cannot change status from ${enrollment.status} to ${statusData.status}`, 400);
      }

      const updatedEnrollment = await EnrollmentModel.updateStatus(enrollmentId, statusData);
      if (!updatedEnrollment) {
        throw createError("Failed to update enrollment status", 500);
      }

      // Invalidate caches
      await this.invalidateEnrollmentCaches(enrollment.student_id, enrollment.learning_path_id);

      logger.info("Enrollment status updated", {
        enrollmentId,
        studentId,
        oldStatus: enrollment.status,
        newStatus: statusData.status,
        reason: statusData.reason
      });

      return EnrollmentModel.transformToEnrollment(updatedEnrollment);
    } catch (error) {
      logger.error("Failed to update enrollment status", {
        enrollmentId,
        studentId,
        statusData,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Bulk enroll students (for organizations)
   */
  async bulkEnrollStudents(bulkData: BulkEnrollmentData): Promise<{
    successful: PathEnrollment[];
    failed: { studentId: string; error: string }[];
  }> {
    try {
      const { learningPathId, studentIds, paymentData, organizationId } = bulkData;
      
      const successful: PathEnrollment[] = [];
      const failed: { studentId: string; error: string }[] = [];

      // Process enrollments in batches to avoid overwhelming the database
      const batchSize = 10;
      for (let i = 0; i < studentIds.length; i += batchSize) {
        const batch = studentIds.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (studentId) => {
          try {
            const enrollment = await this.enrollStudent(learningPathId, studentId, {
              ...paymentData,
              metadata: { organizationId, bulkEnrollment: true }
            });
            successful.push(enrollment);
          } catch (error) {
            failed.push({
              studentId,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        });

        await Promise.all(batchPromises);
      }

      logger.info("Bulk enrollment completed", {
        learningPathId,
        organizationId,
        totalStudents: studentIds.length,
        successful: successful.length,
        failed: failed.length
      });

      return { successful, failed };
    } catch (error) {
      logger.error("Failed to bulk enroll students", {
        bulkData,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get enrollment analytics for a learning path
   */
  async getEnrollmentAnalytics(pathId: string, mentorId: string): Promise<EnrollmentAnalytics> {
    try {
      // Verify mentor owns this path
      const learningPath = await LearningPathModel.findById(pathId);
      if (!learningPath || learningPath.mentor_id !== mentorId) {
        throw createError("Access denied", 403);
      }

      const cacheKey = `${CacheKeys.pathAnalytics(pathId)}:enrollments`;
      
      // Try cache first
      const cached = await CacheService.get<EnrollmentAnalytics>(cacheKey);
      if (cached) {
        logger.debug("Enrollment analytics cache hit", { pathId });
        return cached;
      }

      // Get all enrollments for analytics
      const { enrollments } = await EnrollmentModel.findByLearningPathId(pathId, { limit: 10000 });

      const totalEnrollments = enrollments.length;
      const activeEnrollments = enrollments.filter(e => e.status === 'active').length;
      const completedEnrollments = enrollments.filter(e => e.status === 'completed').length;
      const cancelledEnrollments = enrollments.filter(e => e.status === 'cancelled').length;

      // Calculate average completion time
      const completedWithTime = enrollments.filter(e => 
        e.status === 'completed' && e.enrolled_at && e.completed_at
      );
      
      const averageCompletionTime = completedWithTime.length > 0
        ? completedWithTime.reduce((sum, e) => {
            const enrolledAt = new Date(e.enrolled_at);
            const completedAt = new Date(e.completed_at!);
            return sum + (completedAt.getTime() - enrolledAt.getTime());
          }, 0) / completedWithTime.length / (1000 * 60 * 60 * 24) // Convert to days
        : 0;

      // Calculate rates
      const completionRate = totalEnrollments > 0 ? (completedEnrollments / totalEnrollments) * 100 : 0;
      const retentionRate = totalEnrollments > 0 ? ((totalEnrollments - cancelledEnrollments) / totalEnrollments) * 100 : 0;

      const analytics: EnrollmentAnalytics = {
        totalEnrollments,
        activeEnrollments,
        completedEnrollments,
        cancelledEnrollments,
        averageCompletionTime,
        completionRate,
        retentionRate
      };

      // Cache for 10 minutes
      await CacheService.set(cacheKey, analytics, CacheTTL.medium);

      return analytics;
    } catch (error) {
      logger.error("Failed to get enrollment analytics", {
        pathId,
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get enrollment by ID with access validation
   */
  async getEnrollmentById(enrollmentId: string, userId: string): Promise<PathEnrollment> {
    try {
      const enrollment = await EnrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw createError("Enrollment not found", 404);
      }

      // Check if user has access (student or mentor of the path)
      if (enrollment.student_id !== userId) {
        const learningPath = await LearningPathModel.findById(enrollment.learning_path_id);
        if (!learningPath || learningPath.mentor_id !== userId) {
          throw createError("Access denied", 403);
        }
      }

      return EnrollmentModel.transformToEnrollment(enrollment);
    } catch (error) {
      logger.error("Failed to get enrollment by ID", {
        enrollmentId,
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Check if student can enroll in a learning path
   */
  async canEnroll(learningPathId: string, studentId: string): Promise<{
    canEnroll: boolean;
    reason?: string;
  }> {
    try {
      // Check if learning path exists and is published
      const learningPath = await LearningPathModel.findById(learningPathId);
      if (!learningPath) {
        return { canEnroll: false, reason: "Learning path not found" };
      }

      if (!learningPath.is_published) {
        return { canEnroll: false, reason: "Learning path is not published" };
      }

      // Check if student exists and is active
      const { rows: studentRows } = await pool.query(
        `SELECT id, status FROM users WHERE id = $1 AND is_active = true`,
        [studentId]
      );

      const student = studentRows[0];
      if (!student) {
        return { canEnroll: false, reason: "Student not found" };
      }

      if (student.status === "suspended" || student.status === "banned") {
        return { canEnroll: false, reason: "Student account is not active" };
      }

      // Check if already enrolled
      const existingEnrollment = await EnrollmentModel.findByStudentAndPath(studentId, learningPathId);
      if (existingEnrollment && existingEnrollment.status !== 'cancelled') {
        return { canEnroll: false, reason: "Already enrolled in this learning path" };
      }

      return { canEnroll: true };
    } catch (error) {
      logger.error("Failed to check enrollment eligibility", {
        learningPathId,
        studentId,
        error: error instanceof Error ? error.message : error
      });
      return { canEnroll: false, reason: "Error checking enrollment eligibility" };
    }
  },

  /**
   * Invalidate enrollment-related caches
   */
  async invalidateEnrollmentCaches(studentId: string, learningPathId: string): Promise<void> {
    await Promise.all([
      CacheService.del(CacheKeys.studentEnrollments(studentId)),
      CacheService.del(CacheKeys.pathEnrollments(learningPathId)),
      CacheService.del(CacheKeys.learningPath(learningPathId)),
      CacheService.del(CacheKeys.studentProgress(studentId, learningPathId))
    ]);
  }
};
