import pool from "../config/database";

export interface PredictedSlot {
  startTime: Date;
  endTime: Date;
  probability: number;
  demandScore: number;
  recommendedBookingWindow: string;
}

export interface AvailabilityPrediction {
  mentorId: string;
  predictions: {
    date: Date;
    slots: PredictedSlot[];
  }[];
  confidence: number;
  basedOnWeeks: number;
}

export interface WaitlistEntry {
  id: string;
  mentorId: string;
  userId: string;
  preferredSlot: Date;
  createdAt: Date;
}

export class AvailabilityPredictionService {
  private static readonly ANALYSIS_WEEKS = 8;

  /**
   * Predict mentor availability for the next N days based on historical patterns.
   */
  static async predictAvailability(
    mentorId: string,
    daysAhead = 14,
  ): Promise<AvailabilityPrediction> {
    const historicalSlots = await this.getHistoricalAvailability(mentorId);
    const predictions = this.buildPredictions(historicalSlots, daysAhead);
    const confidence = this.calculateConfidence(historicalSlots.length);

    return {
      mentorId,
      predictions,
      confidence,
      basedOnWeeks: this.ANALYSIS_WEEKS,
    };
  }

  /**
   * Add a user to the waitlist for a mentor's slot.
   */
  static async addToWaitlist(
    mentorId: string,
    userId: string,
    preferredSlot: Date,
  ): Promise<WaitlistEntry> {
    const result = await pool.query(
      `INSERT INTO availability_waitlist (mentor_id, user_id, preferred_slot, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, mentor_id, user_id, preferred_slot, created_at`,
      [mentorId, userId, preferredSlot],
    );
    const row = result.rows[0];
    return {
      id: row.id,
      mentorId: row.mentor_id,
      userId: row.user_id,
      preferredSlot: row.preferred_slot,
      createdAt: row.created_at,
    };
  }

  /**
   * Get waitlist entries for a mentor.
   */
  static async getWaitlist(mentorId: string): Promise<WaitlistEntry[]> {
    const result = await pool.query(
      `SELECT id, mentor_id, user_id, preferred_slot, created_at
       FROM availability_waitlist
       WHERE mentor_id = $1
       ORDER BY created_at ASC`,
      [mentorId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      mentorId: row.mentor_id,
      userId: row.user_id,
      preferredSlot: row.preferred_slot,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get demand forecast: how many bookings a mentor typically gets per day-of-week.
   */
  static async getDemandForecast(
    mentorId: string,
  ): Promise<Record<string, number>> {
    const result = await pool.query(
      `SELECT EXTRACT(DOW FROM scheduled_at) AS dow, COUNT(*) AS count
       FROM bookings
       WHERE mentor_id = $1
         AND status IN ('confirmed', 'completed')
         AND scheduled_at >= NOW() - INTERVAL '${this.ANALYSIS_WEEKS} weeks'
       GROUP BY dow
       ORDER BY dow`,
      [mentorId],
    );

    const forecast: Record<string, number> = {};
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    for (const row of result.rows) {
      forecast[days[parseInt(row.dow)]] = parseInt(row.count);
    }
    return forecast;
  }

  private static async getHistoricalAvailability(
    mentorId: string,
  ): Promise<any[]> {
    const result = await pool.query(
      `SELECT scheduled_at, EXTRACT(DOW FROM scheduled_at) AS dow,
              EXTRACT(HOUR FROM scheduled_at) AS hour
       FROM bookings
       WHERE mentor_id = $1
         AND status IN ('confirmed', 'completed')
         AND scheduled_at >= NOW() - INTERVAL '${this.ANALYSIS_WEEKS} weeks'
       ORDER BY scheduled_at`,
      [mentorId],
    );
    return result.rows;
  }

  private static buildPredictions(
    historicalSlots: any[],
    daysAhead: number,
  ): AvailabilityPrediction["predictions"] {
    // Aggregate frequency by (dow, hour)
    const freq: Record<string, number> = {};
    for (const row of historicalSlots) {
      const key = `${row.dow}-${row.hour}`;
      freq[key] = (freq[key] || 0) + 1;
    }
    const maxFreq = Math.max(1, ...Object.values(freq));

    const predictions: AvailabilityPrediction["predictions"] = [];
    const now = new Date();

    for (let d = 1; d <= daysAhead; d++) {
      const date = new Date(now);
      date.setDate(now.getDate() + d);
      const dow = date.getDay();

      const slots: PredictedSlot[] = [];
      for (let hour = 8; hour <= 20; hour++) {
        const key = `${dow}-${hour}`;
        const count = freq[key] || 0;
        const probability = count / this.ANALYSIS_WEEKS;
        if (probability > 0) {
          const startTime = new Date(date);
          startTime.setHours(hour, 0, 0, 0);
          const endTime = new Date(startTime);
          endTime.setHours(hour + 1);
          const demandScore = count / maxFreq;
          slots.push({
            startTime,
            endTime,
            probability: Math.min(1, probability),
            demandScore,
            recommendedBookingWindow:
              demandScore > 0.7 ? "Book 3+ days ahead" : "Book 1-2 days ahead",
          });
        }
      }

      if (slots.length > 0) {
        predictions.push({ date, slots });
      }
    }

    return predictions;
  }

  private static calculateConfidence(sampleSize: number): number {
    // Simple confidence: saturates at 1.0 with ~50 data points
    return Math.min(1, sampleSize / 50);
  }
}
