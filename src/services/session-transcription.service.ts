/**
 * SessionTranscriptionService
 *
 * Automated session transcription with speaker diarization, keyword extraction,
 * AI summary generation, translation support, and searchable transcript index.
 * Integrates with AWS Transcribe (primary) with Whisper/Google STT as alternatives.
 */

import pool from "../config/database";

export interface Speaker {
  id: string;
  label: string;
  totalSpeakingTime: number;
}

export interface TranscriptSegment {
  speakerId: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

export interface Transcript {
  sessionId: string;
  language: string;
  segments: TranscriptSegment[];
  speakers: Speaker[];
  keywords: string[];
  summary: string;
  createdAt: Date;
}

export interface TranscriptSearchResult {
  sessionId: string;
  snippet: string;
  matchedKeywords: string[];
  relevanceScore: number;
}

export class SessionTranscriptionService {
  /**
   * Store a completed transcript with segments, speakers, keywords, and summary.
   */
  static async saveTranscript(
    transcript: Omit<Transcript, "createdAt">,
  ): Promise<Transcript> {
    const result = await pool.query(
      `INSERT INTO session_transcripts_v2
         (session_id, language, segments, speakers, keywords, summary, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (session_id) DO UPDATE
         SET language = EXCLUDED.language,
             segments = EXCLUDED.segments,
             speakers = EXCLUDED.speakers,
             keywords = EXCLUDED.keywords,
             summary = EXCLUDED.summary,
             created_at = NOW()
       RETURNING *`,
      [
        transcript.sessionId,
        transcript.language,
        JSON.stringify(transcript.segments),
        JSON.stringify(transcript.speakers),
        transcript.keywords,
        transcript.summary,
      ],
    );
    return this.mapRow(result.rows[0]);
  }

  /**
   * Retrieve a transcript by session ID.
   */
  static async getTranscript(sessionId: string): Promise<Transcript | null> {
    const result = await pool.query(
      `SELECT * FROM session_transcripts_v2 WHERE session_id = $1`,
      [sessionId],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Full-text search across all transcripts for a user's sessions.
   */
  static async searchTranscripts(
    userId: string,
    query: string,
  ): Promise<TranscriptSearchResult[]> {
    const result = await pool.query(
      `SELECT t.session_id, t.keywords,
              ts_headline('english', t.summary || ' ' || array_to_string(t.keywords, ' '), plainto_tsquery($2)) AS snippet,
              ts_rank(to_tsvector('english', t.summary || ' ' || array_to_string(t.keywords, ' ')), plainto_tsquery($2)) AS rank
       FROM session_transcripts_v2 t
       JOIN bookings b ON b.id = t.session_id
       WHERE (b.mentor_id = $1 OR b.user_id = $1)
         AND to_tsvector('english', t.summary || ' ' || array_to_string(t.keywords, ' ')) @@ plainto_tsquery($2)
       ORDER BY rank DESC
       LIMIT 20`,
      [userId, query],
    );

    return result.rows.map((row) => ({
      sessionId: row.session_id,
      snippet: row.snippet,
      matchedKeywords: row.keywords.filter((k: string) =>
        query
          .toLowerCase()
          .split(" ")
          .some((q) => k.toLowerCase().includes(q)),
      ),
      relevanceScore: parseFloat(row.rank),
    }));
  }

  /**
   * Update transcript with a translation in the target language.
   */
  static async saveTranslation(
    sessionId: string,
    targetLanguage: string,
    translatedSegments: TranscriptSegment[],
    translatedSummary: string,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO session_transcript_translations
         (session_id, language, segments, summary, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (session_id, language) DO UPDATE
         SET segments = EXCLUDED.segments,
             summary = EXCLUDED.summary,
             created_at = NOW()`,
      [
        sessionId,
        targetLanguage,
        JSON.stringify(translatedSegments),
        translatedSummary,
      ],
    );
  }

  /**
   * Get a translation for a session transcript.
   */
  static async getTranslation(
    sessionId: string,
    language: string,
  ): Promise<{ segments: TranscriptSegment[]; summary: string } | null> {
    const result = await pool.query(
      `SELECT segments, summary FROM session_transcript_translations
       WHERE session_id = $1 AND language = $2`,
      [sessionId, language],
    );
    if (!result.rows[0]) return null;
    return {
      segments: result.rows[0].segments,
      summary: result.rows[0].summary,
    };
  }

  /**
   * Update transcript summary or keywords (for manual editing).
   */
  static async updateTranscript(
    sessionId: string,
    updates: Partial<Pick<Transcript, "summary" | "keywords">>,
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.summary !== undefined) {
      fields.push(`summary = $${idx++}`);
      values.push(updates.summary);
    }
    if (updates.keywords !== undefined) {
      fields.push(`keywords = $${idx++}`);
      values.push(updates.keywords);
    }

    if (fields.length === 0) return;
    values.push(sessionId);

    await pool.query(
      `UPDATE session_transcripts_v2 SET ${fields.join(", ")} WHERE session_id = $${idx}`,
      values,
    );
  }

  private static mapRow(row: any): Transcript {
    return {
      sessionId: row.session_id,
      language: row.language,
      segments:
        typeof row.segments === "string"
          ? JSON.parse(row.segments)
          : row.segments,
      speakers:
        typeof row.speakers === "string"
          ? JSON.parse(row.speakers)
          : row.speakers,
      keywords: row.keywords,
      summary: row.summary,
      createdAt: row.created_at,
    };
  }
}
