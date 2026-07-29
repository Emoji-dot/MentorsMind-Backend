import pool from "../config/database";

export interface MatchScore {
  mentorId: string;
  menteeId: string;
  overallScore: number;
  dimensions: {
    skillMatch: number;
    personalityCompatibility: number;
    learningStyleMatch: number;
    scheduleCompatibility: number;
    successPrediction: number;
    priceCompatibility: number;
  };
  explanation: string[];
  confidence: number;
}

export interface LearningProfile {
  userId: string;
  learningStyle: "visual" | "auditory" | "kinesthetic" | "reading";
  pace: "slow" | "moderate" | "fast";
  preferredSessionLength: number;
  communicationStyle: string;
}

const DIMENSION_WEIGHTS = {
  skillMatch: 0.3,
  personalityCompatibility: 0.15,
  learningStyleMatch: 0.15,
  scheduleCompatibility: 0.2,
  successPrediction: 0.1,
  priceCompatibility: 0.1,
};

async function getMenteeProfile(menteeId: string) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id=$1", [
    menteeId,
  ]);
  return rows[0] ?? null;
}

async function getMentors(limit = 20) {
  const { rows } = await pool.query(
    `SELECT u.id, u.hourly_rate, m.skills, m.timezone, m.rating, m.total_sessions
     FROM users u
     JOIN mentors m ON m.user_id = u.id
     WHERE u.role='mentor' AND u.is_active=true
     LIMIT $1`,
    [limit],
  );
  return rows;
}

async function getLearningProfile(
  userId: string,
): Promise<LearningProfile | null> {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM learning_profiles WHERE user_id=$1",
      [userId],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

function scoreSkillMatch(
  mentorSkills: string[],
  requiredSkills: string[],
): number {
  if (!mentorSkills?.length || !requiredSkills?.length) return 50;
  const matched = requiredSkills.filter((s) =>
    mentorSkills.map((ms) => ms.toLowerCase()).includes(s.toLowerCase()),
  );
  return Math.round((matched.length / requiredSkills.length) * 100);
}

function scoreScheduleCompatibility(
  mentorTimezone: string,
  menteeTimezone: string,
): number {
  if (!mentorTimezone || !menteeTimezone) return 70;
  if (mentorTimezone === menteeTimezone) return 100;
  // Simple offset-based scoring
  const tzOffsets: Record<string, number> = {
    UTC: 0,
    "America/New_York": -5,
    "America/Los_Angeles": -8,
    "Europe/London": 0,
    "Europe/Berlin": 1,
    "Asia/Tokyo": 9,
    "Asia/Kolkata": 5.5,
  };
  const diff = Math.abs(
    (tzOffsets[mentorTimezone] ?? 0) - (tzOffsets[menteeTimezone] ?? 0),
  );
  return Math.max(0, 100 - diff * 8);
}

function scorePriceCompatibility(mentorRate: number, budget: number): number {
  if (!budget || !mentorRate) return 70;
  if (mentorRate <= budget) return 100;
  const overage = (mentorRate - budget) / budget;
  return Math.max(0, Math.round(100 - overage * 100));
}

function scoreSuccessPrediction(
  mentorRating: number,
  totalSessions: number,
): number {
  const ratingScore = ((mentorRating ?? 3) / 5) * 70;
  const experienceScore = Math.min(totalSessions ?? 0, 100) * 0.3;
  return Math.round(ratingScore + experienceScore);
}

function buildExplanation(dimensions: MatchScore["dimensions"]): string[] {
  const explanations: string[] = [];
  if (dimensions.skillMatch >= 80)
    explanations.push("Strong skill alignment with your learning goals");
  else if (dimensions.skillMatch >= 50)
    explanations.push("Partial skill match — mentor covers key areas");
  else explanations.push("Limited skill overlap — consider broadening search");

  if (dimensions.scheduleCompatibility >= 80)
    explanations.push("Compatible timezone and schedule");
  else if (dimensions.scheduleCompatibility < 50)
    explanations.push("Timezone difference may require flexible scheduling");

  if (dimensions.priceCompatibility >= 80)
    explanations.push("Rate fits within your budget");
  else explanations.push("Rate slightly above budget — may offer value");

  if (dimensions.successPrediction >= 80)
    explanations.push("High-rated mentor with proven track record");

  return explanations;
}

export const MentorMatchingV2Service = {
  async findMatches(
    menteeId: string,
    options: { skills?: string[]; budget?: number; limit?: number } = {},
  ): Promise<MatchScore[]> {
    const menteeProfile = await getMenteeProfile(menteeId);
    const learningProfile = await getLearningProfile(menteeId);
    const mentors = await getMentors(options.limit ?? 20);

    const scores: MatchScore[] = mentors.map((mentor) => {
      const mentorSkills: string[] = Array.isArray(mentor.skills)
        ? mentor.skills
        : [];
      const requiredSkills: string[] = options.skills ?? [];

      const dimensions = {
        skillMatch: scoreSkillMatch(mentorSkills, requiredSkills),
        personalityCompatibility: 70, // Default — requires personality assessment data
        learningStyleMatch: learningProfile ? 75 : 65,
        scheduleCompatibility: scoreScheduleCompatibility(
          mentor.timezone,
          menteeProfile?.timezone,
        ),
        successPrediction: scoreSuccessPrediction(
          parseFloat(mentor.rating ?? "3"),
          parseInt(mentor.total_sessions ?? "0"),
        ),
        priceCompatibility: scorePriceCompatibility(
          parseFloat(mentor.hourly_rate ?? "0"),
          options.budget ?? 0,
        ),
      };

      const overallScore = Math.round(
        Object.entries(dimensions).reduce(
          (sum, [key, val]) =>
            sum +
            val * DIMENSION_WEIGHTS[key as keyof typeof DIMENSION_WEIGHTS],
          0,
        ),
      );

      const confidence =
        requiredSkills.length > 0
          ? Math.min(95, 60 + requiredSkills.length * 5)
          : 60;

      return {
        mentorId: mentor.id,
        menteeId,
        overallScore,
        dimensions,
        explanation: buildExplanation(dimensions),
        confidence,
      };
    });

    return scores.sort((a, b) => b.overallScore - a.overallScore);
  },

  async saveLearningProfile(
    profile: LearningProfile,
  ): Promise<LearningProfile> {
    const { rows } = await pool.query(
      `INSERT INTO learning_profiles (user_id, learning_style, pace, preferred_session_length, communication_style)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET
         learning_style=$2, pace=$3, preferred_session_length=$4, communication_style=$5, updated_at=CURRENT_TIMESTAMP
       RETURNING *`,
      [
        profile.userId,
        profile.learningStyle,
        profile.pace,
        profile.preferredSessionLength,
        profile.communicationStyle,
      ],
    );
    return rows[0];
  },

  async getLearningProfile(userId: string): Promise<LearningProfile | null> {
    return getLearningProfile(userId);
  },
};
