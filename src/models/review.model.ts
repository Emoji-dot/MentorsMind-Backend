import { db } from "../config/database";

export interface Review {
  id: string;
  session_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string | null;
  created_at: Date;
}

export const ReviewModel = {
  async findByUserId(userId: string): Promise<Review[]> {
    const query =
      "SELECT * FROM reviews WHERE reviewer_id = $1 OR reviewee_id = $1 ORDER BY created_at DESC;";
    const { rows } = await db.query(query, [userId]);
    return rows;
  },

  /**
   * Bulk fetch reviews for multiple users.
   * A review can match as either reviewer_id or reviewee_id.
   */
  async findByUserIds(userIds: string[]): Promise<Review[]> {
    if (userIds.length === 0) return [];
    const query =
      "SELECT * FROM reviews WHERE reviewer_id = ANY($1) OR reviewee_id = ANY($1) ORDER BY created_at DESC;";
    const { rows } = await db.query(query, [userIds]);
    return rows;
  },
};
