/**
 * Data Export Job
 *
 * Processes EXPORT queue jobs with:
 *  - BullMQ job.updateProgress() at each milestone
 *  - Socket.IO export:progress events to the requesting user
 *  - export:ready Socket.IO event + email on completion
 *  - Three output formats: JSON (zip), CSV (zip, one file per entity), PDF
 *  - Size-estimation guard: warn >500 MB, block >1 GB until admin approves
 *
 * Progress milestones:
 *  0  → job started
 *  10 → fetching_bookings
 *  30 → fetching_payments
 *  50 → fetching_messages
 *  70 → fetching_notes_and_reviews
 *  80 → generating_file
 *  95 → uploading_s3
 * 100 → done
 */

import fs from "fs";
import path from "path";
import archiver from "archiver";
import crypto from "crypto";
import { Job } from "bullmq";
import PDFDocument from "pdfkit";
import pool from "../config/database";
import { ExportJobModel, ExportFormat } from "../models/export-job.model";
import { UsersService } from "../services/users.service";
import { StorageService } from "../services/storage.service";
import { SocketService } from "../services/socket.service";
import { enqueueEmail } from "../queues/email.queue";
import { AuditLoggerService } from "../services/audit-logger.service";
import { LogLevel } from "../utils/log-formatter.utils";
import { logger } from "../utils/logger.utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportJobPayload {
  userId: string;
  jobId: string;           // export_jobs.id
  format?: ExportFormat;   // default: 'json'
  requestId?: string;      // legacy compat — same as jobId
}

interface ExportData {
  profile: Record<string, any> | null;
  bookings: any[];
  payments: any[];
  messages: any[];
  reviews: any[];
  notes: any[];
  auditLogs: any[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WARN_SIZE_BYTES  = 500 * 1024 * 1024;  // 500 MB
const BLOCK_SIZE_BYTES = 1024 * 1024 * 1024; // 1 GB
const EXPORT_LINK_TTL  = 7 * 24 * 60 * 60;  // 7 days in seconds
const TEMP_DIR         = path.join(process.cwd(), "temp");

// Sensitive fields to strip from user profile before export
const PROFILE_STRIP_FIELDS = [
  "password_hash", "refresh_token", "reset_token",
  "totp_secret", "backup_codes", "pin_hash",
];

// ---------------------------------------------------------------------------
// Progress helper
// ---------------------------------------------------------------------------

interface ProgressEvent {
  step: string;
  percent: number;
  jobId: string;
}

async function reportProgress(
  job: Job,
  userId: string,
  step: string,
  percent: number,
): Promise<void> {
  await job.updateProgress(percent);

  const payload: ProgressEvent = { step, percent, jobId: job.data.jobId ?? job.id };
  SocketService.emitToUser(userId, "export:progress", payload);

  logger.debug("[DataExportJob] Progress", { userId, step, percent, jobId: job.id });
}

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

function stripSensitiveFields(obj: Record<string, any>): Record<string, any> {
  const safe = { ...obj };
  for (const field of PROFILE_STRIP_FIELDS) {
    delete safe[field];
  }
  return safe;
}

async function collectData(userId: string): Promise<ExportData> {
  const [profile, bookings, payments, messages, reviews, notes, auditLogs] =
    await Promise.all([
      UsersService.findById(userId),
      pool
        .query("SELECT * FROM bookings WHERE mentee_id = $1 OR mentor_id = $1", [userId])
        .then((r) => r.rows),
      pool
        .query("SELECT * FROM transactions WHERE user_id = $1", [userId])
        .then((r) => r.rows),
      pool
        .query(
          `SELECT m.* FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE c.participant_one_id = $1 OR c.participant_two_id = $1`,
          [userId],
        )
        .then((r) => r.rows),
      pool
        .query("SELECT * FROM reviews WHERE reviewer_id = $1 OR reviewee_id = $1", [userId])
        .then((r) => r.rows),
      pool
        .query("SELECT * FROM session_notes WHERE author_id = $1", [userId])
        .catch(() => ({ rows: [] }))  // table may not exist in all envs
        .then((r) => r.rows),
      pool
        .query("SELECT * FROM audit_logs WHERE user_id = $1 LIMIT 1000", [userId])
        .then((r) => r.rows),
    ]);

  return {
    profile: profile ? stripSensitiveFields(profile as any) : null,
    bookings,
    payments,
    messages,
    reviews,
    notes,
    auditLogs,
  };
}

// ---------------------------------------------------------------------------
// Rough size estimator (counts rows × avg bytes per row)
// Used before data collection to gate large exports.
// ---------------------------------------------------------------------------

async function estimateExportBytes(userId: string): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT (
       (SELECT COUNT(*) FROM bookings WHERE mentee_id = $1 OR mentor_id = $1) * 1024 +
       (SELECT COUNT(*) FROM transactions WHERE user_id = $1) * 512 +
       (SELECT COUNT(*) FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          WHERE c.participant_one_id = $1 OR c.participant_two_id = $1) * 2048 +
       (SELECT COUNT(*) FROM reviews WHERE reviewer_id = $1 OR reviewee_id = $1) * 512 +
       (SELECT COUNT(*) FROM audit_logs WHERE user_id = $1) * 256 +
       10240  -- base overhead (profile + notes)
     )::bigint AS total`,
    [userId],
  );
  return parseInt(rows[0]?.total ?? "0", 10);
}

// ---------------------------------------------------------------------------
// Format generators
// ---------------------------------------------------------------------------

function jsonToCsvRow(headers: string[], row: any): string {
  return headers
    .map((h) => {
      const v = row[h];
      if (v === null || v === undefined) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    })
    .join(",");
}

function entityToCsv(rows: any[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((r) => jsonToCsvRow(headers, r))].join("\r\n");
}

/** Build a ZIP archive with one JSON file per entity. */
async function buildJsonZip(data: ExportData, tempPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(tempPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("finish", resolve);
    archive.on("error", reject);
    archive.pipe(output);

    archive.append(JSON.stringify(data.profile, null, 2),  { name: "profile.json" });
    archive.append(JSON.stringify(data.bookings, null, 2), { name: "bookings.json" });
    archive.append(JSON.stringify(data.payments, null, 2), { name: "payments.json" });
    archive.append(JSON.stringify(data.messages, null, 2), { name: "messages.json" });
    archive.append(JSON.stringify(data.reviews, null, 2),  { name: "reviews.json" });
    archive.append(JSON.stringify(data.notes, null, 2),    { name: "notes.json" });
    archive.append(JSON.stringify(data.auditLogs, null, 2),{ name: "audit_logs.json" });

    archive.finalize();
  });
}

/** Build a ZIP archive with one CSV file per entity. */
async function buildCsvZip(data: ExportData, tempPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(tempPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("finish", resolve);
    archive.on("error", reject);
    archive.pipe(output);

    const profileRow = data.profile ? [data.profile] : [];

    archive.append(entityToCsv(profileRow),      { name: "profile.csv" });
    archive.append(entityToCsv(data.bookings),   { name: "bookings.csv" });
    archive.append(entityToCsv(data.payments),   { name: "payments.csv" });
    archive.append(entityToCsv(data.messages),   { name: "messages.csv" });
    archive.append(entityToCsv(data.reviews),    { name: "reviews.csv" });
    archive.append(entityToCsv(data.notes),      { name: "notes.csv" });
    archive.append(entityToCsv(data.auditLogs),  { name: "audit_logs.csv" });

    archive.finalize();
  });
}

/** Build a formatted PDF report. */
async function buildPdf(data: ExportData, tempPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const output = fs.createWriteStream(tempPath);

    output.on("finish", resolve);
    output.on("error", reject);
    doc.on("error", reject);

    doc.pipe(output);

    const brandColor = "#0066cc";
    const profile = data.profile || {};

    // ── Cover ──
    doc.fontSize(24).font("Helvetica-Bold").fillColor(brandColor)
      .text("MentorMinds", 50, 40);
    doc.strokeColor("#cccccc").lineWidth(1).moveTo(50, 65).lineTo(545, 65).stroke();
    doc.moveDown(2);
    doc.fontSize(20).font("Helvetica-Bold").fillColor("#333333")
      .text("Personal Data Export", { align: "center" });
    doc.fontSize(11).font("Helvetica").fillColor("#666666")
      .text(`Generated: ${new Date().toUTCString()}`, { align: "center" });
    doc.moveDown(1);
    doc.text(`User ID: ${profile.id ?? "N/A"}`, { align: "center" });
    doc.text(`Email: ${profile.email ?? "N/A"}`, { align: "center" });

    // ── Section helper ──
    const section = (title: string) => {
      if (doc.y > 700) doc.addPage();
      doc.moveDown(1);
      doc.fontSize(13).font("Helvetica-Bold").fillColor(brandColor).text(title);
      doc.strokeColor(brandColor).lineWidth(0.5)
        .moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(9).font("Helvetica").fillColor("#333333");
    };

    const tableRow = (label: string, value: any) => {
      doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
      doc.font("Helvetica").text(String(value ?? "N/A"));
    };

    // ── Profile ──
    section("Profile");
    const PROFILE_DISPLAY = [
      "first_name","last_name","email","role","timezone","created_at","is_active",
    ];
    for (const key of PROFILE_DISPLAY) {
      if (profile[key] !== undefined) tableRow(key, profile[key]);
    }

    // ── Bookings summary ──
    section(`Bookings (${data.bookings.length} total)`);
    if (data.bookings.length === 0) {
      doc.text("No bookings found.");
    } else {
      const displayed = data.bookings.slice(0, 30);
      for (const b of displayed) {
        doc.text(
          `• ${b.scheduled_at ? new Date(b.scheduled_at).toDateString() : "?"} — ` +
          `${b.status ?? "?"} — ${b.duration_minutes ?? "?"}min`,
        );
      }
      if (data.bookings.length > 30) {
        doc.fillColor("#888888").text(`...and ${data.bookings.length - 30} more.`);
        doc.fillColor("#333333");
      }
    }

    // ── Payments summary ──
    section(`Payments (${data.payments.length} total)`);
    if (data.payments.length === 0) {
      doc.text("No payments found.");
    } else {
      const total = data.payments.reduce((s, p) => s + parseFloat(p.amount ?? 0), 0);
      doc.text(`Total transactions: ${data.payments.length}`);
      doc.text(`Total amount: ${total.toFixed(2)}`);
      doc.moveDown(0.3);
      for (const p of data.payments.slice(0, 20)) {
        doc.text(`• ${p.created_at ? new Date(p.created_at).toDateString() : "?"} — ${p.amount ?? "?"} ${p.currency ?? ""} — ${p.status ?? "?"}`);
      }
    }

    // ── Messages summary ──
    section(`Messages (${data.messages.length} total)`);
    doc.text(`${data.messages.length} message(s) on record.`);
    if (data.messages.length > 0) {
      doc.text("Full message content is available in the JSON/CSV export format.");
    }

    // ── Reviews ──
    section(`Reviews (${data.reviews.length} total)`);
    for (const r of data.reviews.slice(0, 20)) {
      doc.text(`• Rating: ${r.rating ?? "?"}/5 — ${r.content?.slice(0, 80) ?? "No content"}`);
    }

    // ── Footer ──
    const footerY = doc.page.height - 40;
    doc.fontSize(8).fillColor("#aaaaaa")
      .moveTo(50, footerY).lineTo(545, footerY).stroke()
      .text("This export contains your personal data as required by GDPR Article 20 (Data Portability).", 50, footerY + 8, { align: "center" });

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Main job runner
// ---------------------------------------------------------------------------

export async function runDataExportJob(job: Job<ExportJobPayload>): Promise<void> {
  const { userId, format = "json" } = job.data;
  // Support both jobId and requestId (legacy) as the export_jobs.id
  const exportDbId: string = job.data.jobId || job.data.requestId || job.id!;

  logger.info("[DataExportJob] Started", { userId, exportDbId, format, bullmqJobId: job.id });

  // Persist the BullMQ job ID back to the DB so the /progress endpoint can look it up
  await ExportJobModel.setBullmqJobId(exportDbId, job.id!);

  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  const tempFileName = `export_${userId}_${Date.now()}.${format === "pdf" ? "pdf" : "zip"}`;
  const tempFilePath = path.join(TEMP_DIR, tempFileName);

  try {
    // ── Step 0: check approval for very large exports ──────────────────────
    const dbJob = await ExportJobModel.findById(exportDbId);
    if (dbJob?.approval_status === "rejected") {
      await ExportJobModel.updateStatus(exportDbId, "failed", undefined, "Export rejected by admin");
      SocketService.emitToUser(userId, "export:progress", {
        step: "rejected", percent: 0, jobId: exportDbId,
      });
      return;
    }
    if (dbJob?.approval_status === "pending") {
      logger.info("[DataExportJob] Waiting for admin approval", { exportDbId });
      // Job will be re-enqueued once admin approves — do nothing now
      return;
    }

    await ExportJobModel.updateStatus(exportDbId, "processing");
    await reportProgress(job, userId, "started", 0);

    // ── Step 1: estimate size ──────────────────────────────────────────────
    const estimatedBytes = await estimateExportBytes(userId);

    if (estimatedBytes > BLOCK_SIZE_BYTES && dbJob?.approval_status !== "approved") {
      // Gate: require admin approval
      await ExportJobModel.updateApprovalStatus
        ? await pool.query(
            `UPDATE export_jobs SET approval_status='pending', estimated_size_bytes=$2, status='pending' WHERE id=$1`,
            [exportDbId, estimatedBytes],
          )
        : null;

      SocketService.emitToUser(userId, "export:progress", {
        step: "awaiting_admin_approval",
        percent: 0,
        jobId: exportDbId,
        estimatedSizeBytes: estimatedBytes,
        message: "Your export exceeds 1 GB and requires admin approval before processing.",
      });

      logger.warn("[DataExportJob] Export blocked — pending admin approval", {
        userId, exportDbId, estimatedBytes,
      });
      return;
    }

    if (estimatedBytes > WARN_SIZE_BYTES) {
      logger.warn("[DataExportJob] Large export — warn threshold exceeded", {
        userId, exportDbId, estimatedBytes,
      });
      SocketService.emitToUser(userId, "export:progress", {
        step: "large_export_warning",
        percent: 0,
        jobId: exportDbId,
        estimatedSizeBytes: estimatedBytes,
        message: "Your export is large (>500 MB) and may take several minutes.",
      });
    }

    // ── Step 2: fetch bookings ─────────────────────────────────────────────
    await reportProgress(job, userId, "fetching_bookings", 10);
    const bookings = await pool
      .query("SELECT * FROM bookings WHERE mentee_id = $1 OR mentor_id = $1", [userId])
      .then((r) => r.rows);

    // ── Step 3: fetch payments ─────────────────────────────────────────────
    await reportProgress(job, userId, "fetching_payments", 30);
    const payments = await pool
      .query("SELECT * FROM transactions WHERE user_id = $1", [userId])
      .then((r) => r.rows);

    // ── Step 4: fetch messages ─────────────────────────────────────────────
    await reportProgress(job, userId, "fetching_messages", 50);
    const messages = await pool
      .query(
        `SELECT m.* FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.participant_one_id = $1 OR c.participant_two_id = $1`,
        [userId],
      )
      .then((r) => r.rows);

    // ── Step 5: fetch notes, reviews, profile, audit logs ─────────────────
    await reportProgress(job, userId, "fetching_notes_and_reviews", 70);
    const [reviews, notes, auditLogs, rawProfile] = await Promise.all([
      pool.query("SELECT * FROM reviews WHERE reviewer_id = $1 OR reviewee_id = $1", [userId]).then((r) => r.rows),
      pool.query("SELECT * FROM session_notes WHERE author_id = $1", [userId]).catch(() => ({ rows: [] })).then((r) => r.rows),
      pool.query("SELECT * FROM audit_logs WHERE user_id = $1 LIMIT 1000", [userId]).then((r) => r.rows),
      UsersService.findById(userId),
    ]);

    const profile = rawProfile ? stripSensitiveFields(rawProfile as any) : null;

    const data: ExportData = { profile, bookings, payments, messages, reviews, notes, auditLogs };

    // ── Step 6: generate file ──────────────────────────────────────────────
    await reportProgress(job, userId, "generating_file", 80);

    if (format === "json") {
      await buildJsonZip(data, tempFilePath);
    } else if (format === "csv") {
      await buildCsvZip(data, tempFilePath);
    } else {
      await buildPdf(data, tempFilePath);
    }

    const fileBuffer = fs.readFileSync(tempFilePath);
    const actualSizeBytes = fileBuffer.length;
    const checksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");

    // ── Step 7: upload to S3 ───────────────────────────────────────────────
    await reportProgress(job, userId, "uploading_s3", 95);

    const contentType = format === "pdf" ? "application/pdf" : "application/zip";
    const s3Key = StorageService.buildExportKey(userId, exportDbId, Date.now());
    await StorageService.uploadFile(s3Key, fileBuffer, contentType, {
      userId,
      format,
      checksum,
    });

    // Cleanup temp file immediately after upload
    fs.unlinkSync(tempFilePath);

    // ── Step 8: update DB ──────────────────────────────────────────────────
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await ExportJobModel.updateStatus(exportDbId, "completed", s3Key, undefined, expiresAt, {
      actualSizeBytes,
    });

    const downloadUrl = await StorageService.generatePresignedUrl(s3Key, EXPORT_LINK_TTL);

    // ── Step 9: emit export:ready ──────────────────────────────────────────
    await reportProgress(job, userId, "done", 100);
    SocketService.emitToUser(userId, "export:ready", {
      jobId: exportDbId,
      downloadUrl,
      format,
      expiresAt: expiresAt.toISOString(),
      sizeBytes: actualSizeBytes,
      checksum,
    });

    // ── Step 10: send email notification ───────────────────────────────────
    const user = await UsersService.findById(userId);
    if (user?.email) {
      try {
        await enqueueEmail({
          to: [user.email],
          subject: "Your MentorMinds data export is ready",
          templateId: "data_export_ready",
          templateData: {
            userName: user.first_name
              ? `${user.first_name} ${user.last_name ?? ""}`.trim()
              : "there",
            downloadUrl,
            expiresAt: expiresAt.toISOString(),
            format: format.toUpperCase(),
            sizeFormatted: formatBytes(actualSizeBytes),
            platformUrl: process.env.APP_CLIENT_URL || "https://mentorsmind.com",
            supportUrl: process.env.SUPPORT_URL || "https://mentorsmind.com/support",
          },
        });
      } catch (emailErr) {
        // Non-fatal — export is complete regardless
        logger.warn("[DataExportJob] Failed to send completion email", {
          userId, exportDbId,
          error: emailErr instanceof Error ? emailErr.message : String(emailErr),
        });
      }
    }

    await AuditLoggerService.logEvent({
      level: LogLevel.INFO,
      action: "DATA_EXPORT_COMPLETED",
      message: `Data export completed for user ${userId}`,
      userId,
      entityType: "export_job",
      entityId: exportDbId,
      metadata: { format, s3Key, sizeBytes: actualSizeBytes, checksum },
    });

    logger.info("[DataExportJob] Completed", {
      userId, exportDbId, format, sizeBytes: actualSizeBytes,
    });
  } catch (error: any) {
    // Cleanup temp file on failure
    if (fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch { /* ignore */ }
    }

    await ExportJobModel.updateStatus(exportDbId, "failed", undefined, error.message);

    SocketService.emitToUser(userId, "export:progress", {
      step: "failed",
      percent: -1,
      jobId: exportDbId,
      error: error.message,
    });

    await AuditLoggerService.logEvent({
      level: LogLevel.ERROR,
      action: "DATA_EXPORT_FAILED",
      message: `Data export failed for user ${userId}: ${error.message}`,
      userId,
      entityType: "export_job",
      entityId: exportDbId,
      metadata: { error: error.message, format },
    });

    logger.error("[DataExportJob] Failed", { userId, exportDbId, error: error.message });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
