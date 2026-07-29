jest.mock("../../models/goal.model", () => ({
  GoalModel: {
    create: jest.fn(),
    findByLearnerId: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    linkBooking: jest.fn(),
    getProgressLogs: jest.fn(),
    logProgress: jest.fn(),
    findAtRiskGoals: jest.fn(),
    findGoalsForReminder: jest.fn(),
    markReminderSent: jest.fn(),
    findBestMentorSuggestion: jest.fn(),
  },
}));

jest.mock("../learners.service", () => ({
  LearnerService: {
    invalidateCache: jest.fn(),
  },
}));

import { GoalModel } from "../../models/goal.model";
import { GoalService } from "../goal.service";

const findById = GoalModel.findById as jest.Mock;
const update = GoalModel.update as jest.Mock;
const findBestMentorSuggestion = GoalModel.findBestMentorSuggestion as jest.Mock;

describe("GoalService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resets reminder flags when the target date changes", async () => {
    findById.mockResolvedValueOnce({
      id: "goal-1",
      learner_id: "learner-1",
      title: "Learn React",
      target_date: "2026-08-10",
      progress: 20,
      status: "active",
      reminder_sent_7d: true,
      reminder_sent_3d: true,
      reminder_sent_1d: true,
      overdue_notified: true,
    });
    update.mockResolvedValueOnce({
      id: "goal-1",
      learner_id: "learner-1",
      title: "Learn React",
      target_date: "2026-08-20",
      progress: 20,
      status: "active",
      reminder_sent_7d: false,
      reminder_sent_3d: false,
      reminder_sent_1d: false,
      overdue_notified: false,
    });

    await GoalService.updateGoal("goal-1", "learner-1", {
      target_date: "2026-08-20",
    });

    expect(update).toHaveBeenCalledWith(
      "goal-1",
      expect.objectContaining({
        target_date: "2026-08-20",
        reminder_sent_7d: false,
        reminder_sent_3d: false,
        reminder_sent_1d: false,
        overdue_notified: false,
      }),
    );
  });

  it("extracts stable goal keywords for mentor matching", () => {
    expect(
      GoalService.extractGoalKeywords({
        title: "Learn React Native",
        description: "Build a mobile app with React and TypeScript",
      }),
    ).toEqual(
      expect.arrayContaining([
        "learn react native",
        "react",
        "native",
        "mobile",
        "typescript",
      ]),
    );
  });

  it("returns a booking suggestion with a booking URL", async () => {
    findBestMentorSuggestion.mockResolvedValueOnce({
      id: "mentor-1",
      first_name: "Ada",
      last_name: "Lovelace",
      expertise: ["react", "typescript"],
      hourly_rate: 80,
      average_rating: 4.9,
      total_sessions_completed: 120,
      is_available: true,
      session_goal_alignment: 0.92,
    });

    await expect(
      GoalService.getBookingSuggestion({
        title: "Master React",
        description: "Need help shipping a TypeScript app",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "mentor-1",
        booking_url: "/api/v1/bookings",
      }),
    );
  });
});
