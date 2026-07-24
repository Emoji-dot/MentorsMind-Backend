import { db } from "../config/database";

export interface BookingRecord {
  id: string;
  mentee_id: string;
  mentor_id: string;
  scheduled_at: Date;
  duration_minutes: number;
  topic: string;
  notes: string | null;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rescheduled";
  amount: string;
  currency: string;
  usd_equivalent: string | null;
  payment_status: "pending" | "paid" | "refunded" | "failed";
  stellar_tx_hash: string | null;
  transaction_id: string | null;
  cancellation_reason: string | null;
  session_id?: string;
  meeting_id?: string;
  meeting_url?: string;
  created_at: Date;
  updated_at: Date;
}

export const BookingModel = {
  async create(data: {
    menteeId: string;
    mentorId: string;
    scheduledAt: Date;
    durationMinutes: number;
    topic: string;
    notes?: string;
    amount: string;
    currency: string;
    usdEquivalent?: string | null;
  }): Promise<BookingRecord> {
    const { rows } = await db.query(
      `INSERT INTO bookings (mentee_id, mentor_id, scheduled_at, duration_minutes, topic, notes, amount, currency, usd_equivalent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.menteeId,
        data.mentorId,
        data.scheduledAt,
        data.durationMinutes,
        data.topic,
        data.notes || null,
        data.amount,
        data.currency,
        data.usdEquivalent ?? null,
      ],
    );
    return rows[0];
  },

  async findById(id: string): Promise<BookingRecord | null> {
    const { rows } = await db.query(`SELECT * FROM bookings WHERE id = $1`, [
      id,
    ]);
    return rows[0] || null;
  },

  async findByUserId(
    userId: string,
    filters?: {
      status?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{ bookings: BookingRecord[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 10;
    const offset = (page - 1) * limit;

    let whereClause = "(mentee_id = $1 OR mentor_id = $1)";
    const params: any[] = [userId];
    let paramIndex = 2;

    if (filters?.status) {
      whereClause += ` AND status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    const [dataResult, countResult] = await Promise.all([
      db.query(
        `SELECT * FROM bookings WHERE ${whereClause} ORDER BY scheduled_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset],
      ),
      db.query(`SELECT COUNT(*) FROM bookings WHERE ${whereClause}`, params),
    ]);

    return {
      bookings: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  },

  async findByUserIds(userIds: string[]): Promise<BookingRecord[]> {
    if (userIds.length === 0) return [];
    const { rows } = await db.query(
      `SELECT * FROM bookings WHERE mentee_id = ANY($1) OR mentor_id = ANY($1) ORDER BY scheduled_at DESC`,
      [userIds],
    );
    return rows;
  },

  async update(
    id: string,
    data: Partial<{
      scheduledAt: Date;
      durationMinutes: number;
      topic: string;
      notes: string;
      status: string;
      paymentStatus: string;
      stellarTxHash: string;
      transactionId: string;
      cancellationReason: string;
    }>,
  ): Promise<BookingRecord | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.scheduledAt !== undefined) {
      fields.push(`scheduled_at = $${idx++}`);
      values.push(data.scheduledAt);
    }
    if (data.durationMinutes !== undefined) {
      fields.push(`duration_minutes = $${idx++}`);
      values.push(data.durationMinutes);
    }
    if (data.topic !== undefined) {
      fields.push(`topic = $${idx++}`);
      values.push(data.topic);
    }
    if (data.notes !== undefined) {
      fields.push(`notes = $${idx++}`);
      values.push(data.notes);
    }
    if (data.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(data.status);
    }
    if (data.paymentStatus !== undefined) {
      fields.push(`payment_status = $${idx++}`);
      values.push(data.paymentStatus);
    }
    if (data.stellarTxHash !== undefined) {
      fields.push(`stellar_tx_hash = $${idx++}`);
      values.push(data.stellarTxHash);
    }
    if (data.transactionId !== undefined) {
      fields.push(`transaction_id = $${idx++}`);
      values.push(data.transactionId);
    }
    if (data.cancellationReason !== undefined) {
      fields.push(`cancellation_reason = $${idx++}`);
      values.push(data.cancellationReason);
    }

    if (fields.length === 0) return this.findById(id);

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await db.query(
      `UPDATE bookings SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return rows[0] || null;
  },

  async checkConflict(
    mentorId: string,
    scheduledAt: Date,
    durationMinutes: number,
    excludeBookingId?: string,
  ): Promise<boolean> {
    const endTime = new Date(scheduledAt.getTime() + durationMinutes * 60000);

    let query = `
      SELECT COUNT(*) FROM bookings
      WHERE mentor_id = $1
        AND status NOT IN ('cancelled', 'completed')
        AND (
          (scheduled_at <= $2 AND scheduled_at + (duration_minutes || ' minutes')::INTERVAL > $2)
          OR (scheduled_at < $3 AND scheduled_at + (duration_minutes || ' minutes')::INTERVAL >= $3)
          OR (scheduled_at >= $2 AND scheduled_at < $3)
        )
    `;

    const params: any[] = [mentorId, scheduledAt, endTime];

    if (excludeBookingId) {
      query += ` AND id != $4`;
      params.push(excludeBookingId);
    }

    const { rows } = await db.query(query, params);
    return parseInt(rows[0].count, 10) > 0;
  },
};
