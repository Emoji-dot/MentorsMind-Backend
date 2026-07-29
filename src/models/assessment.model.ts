import pool from "../config/database";

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctAnswer: number;
  points: number;
}

export interface Answer {
  questionId: string;
  selectedOption: number;
  isCorrect: boolean;
}

export interface Assessment {
  id: string;
  title: string;
  skill: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  questions: Question[];
  time_limit: number;
  passing_score: number;
  adaptive_enabled: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface AssessmentResult {
  id: string;
  user_id: string;
  assessment_id: string;
  score: number;
  passed: boolean;
  answers: Answer[];
  skill_level: number;
  recommendations: string[];
  completed_at: Date;
}

export const AssessmentModel = {
  async create(
    data: Omit<Assessment, "id" | "created_at" | "updated_at">,
  ): Promise<Assessment> {
    const { rows } = await pool.query<Assessment>(
      `INSERT INTO assessments (title, skill, difficulty, questions, time_limit, passing_score, adaptive_enabled, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        data.title,
        data.skill,
        data.difficulty,
        JSON.stringify(data.questions),
        data.time_limit,
        data.passing_score,
        data.adaptive_enabled,
        data.created_by,
      ],
    );
    return rows[0];
  },

  async findById(id: string): Promise<Assessment | null> {
    const { rows } = await pool.query<Assessment>(
      "SELECT * FROM assessments WHERE id=$1",
      [id],
    );
    return rows[0] ?? null;
  },

  async findAll(skill?: string, difficulty?: string): Promise<Assessment[]> {
    let query = "SELECT * FROM assessments WHERE 1=1";
    const params: string[] = [];
    if (skill) {
      params.push(skill);
      query += ` AND skill=$${params.length}`;
    }
    if (difficulty) {
      params.push(difficulty);
      query += ` AND difficulty=$${params.length}`;
    }
    query += " ORDER BY created_at DESC";
    const { rows } = await pool.query<Assessment>(query, params);
    return rows;
  },

  async saveResult(
    data: Omit<AssessmentResult, "id">,
  ): Promise<AssessmentResult> {
    const { rows } = await pool.query<AssessmentResult>(
      `INSERT INTO assessment_results (user_id, assessment_id, score, passed, answers, skill_level, recommendations, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        data.user_id,
        data.assessment_id,
        data.score,
        data.passed,
        JSON.stringify(data.answers),
        data.skill_level,
        JSON.stringify(data.recommendations),
        data.completed_at,
      ],
    );
    return rows[0];
  },

  async findResultsByUser(userId: string): Promise<AssessmentResult[]> {
    const { rows } = await pool.query<AssessmentResult>(
      "SELECT * FROM assessment_results WHERE user_id=$1 ORDER BY completed_at DESC",
      [userId],
    );
    return rows;
  },
};
