jest.mock("../../services/goal.service", () => ({
  GoalService: {
    getGoalsDueForReminder: jest.fn(),
    markReminderSent: jest.fn(),
    getBookingSuggestion: jest.fn(),
  },
}));

jest.mock("../../services/notification.service", () => ({
  NotificationService: {
    createInAppNotification: jest.fn(),
    sendEmail: jest.fn(),
    sendPush: jest.fn(),
  },
}));

jest.mock("../../config/metrics", () => ({
  goalRemindersSentTotal: {
    labels: jest.fn(() => ({
      inc: jest.fn(),
    })),
  },
}));

import { GoalService } from "../../services/goal.service";
import { NotificationService } from "../../services/notification.service";
import { goalRemindersSentTotal } from "../../config/metrics";
import { goalReminderJob } from "../goalReminder.job";

const getGoalsDueForReminder = GoalService.getGoalsDueForReminder as jest.Mock;
const markReminderSent = GoalService.markReminderSent as jest.Mock;
const getBookingSuggestion = GoalService.getBookingSuggestion as jest.Mock;
const createInAppNotification =
  NotificationService.createInAppNotification as jest.Mock;
const sendEmail = NotificationService.sendEmail as jest.Mock;
const sendPush = NotificationService.sendPush as jest.Mock;
const metricLabels = goalRemindersSentTotal.labels as jest.Mock;

describe("goalReminderJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getGoalsDueForReminder.mockResolvedValue([]);
    getBookingSuggestion.mockResolvedValue(null);
    sendEmail.mockResolvedValue(true);
    sendPush.mockResolvedValue(true);
  });

  it("sends only an in-app reminder for 7-day deadlines", async () => {
    getGoalsDueForReminder
      .mockResolvedValueOnce([
        {
          id: "goal-1",
          learner_id: "learner-1",
          learner_email: "learner@example.com",
          learner_first_name: "Pat",
          learner_last_name: "Lee",
          title: "Learn React",
          description: "Hooks and routing",
          target_date: "2026-08-02",
          progress: 10,
          status: "active",
        },
      ])
      .mockResolvedValue([])
      .mockResolvedValue([])
      .mockResolvedValue([]);

    await goalReminderJob.runDailyCheck();

    expect(createInAppNotification).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
    expect(markReminderSent).toHaveBeenCalledWith("goal-1", "7d");
    expect(metricLabels).toHaveBeenCalledWith("7d");
  });

  it("sends all channels and booking suggestion for overdue goals", async () => {
    getGoalsDueForReminder
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "goal-2",
          learner_id: "learner-2",
          learner_email: "overdue@example.com",
          learner_first_name: "Sam",
          learner_last_name: "Jones",
          title: "Ship a React Native app",
          description: "Need help closing the last sprint",
          target_date: "2026-07-20",
          progress: 25,
          status: "active",
        },
      ]);
    getBookingSuggestion.mockResolvedValueOnce({
      id: "mentor-9",
      first_name: "Grace",
      last_name: "Hopper",
      expertise: ["react native"],
      hourly_rate: 95,
      average_rating: 4.8,
      total_sessions_completed: 88,
      is_available: true,
      session_goal_alignment: 0.87,
      booking_url: "/api/v1/bookings",
    });

    await goalReminderJob.runDailyCheck();

    expect(createInAppNotification).toHaveBeenCalledWith(
      "learner-2",
      "goal_overdue",
      expect.stringContaining("Goal overdue"),
      expect.stringContaining("Suggested mentor"),
      expect.objectContaining({
        suggestedMentorId: "mentor-9",
        suggestedBookingUrl: "/api/v1/bookings",
      }),
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(markReminderSent).toHaveBeenCalledWith("goal-2", "overdue");
    expect(metricLabels).toHaveBeenCalledWith("overdue");
  });
});
