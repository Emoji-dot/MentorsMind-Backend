import { CronJob } from "cron";
import { goalRemindersSentTotal } from "../config/metrics";
import {
  GoalReminderCandidate,
  GoalReminderType,
} from "../models/goal.model";
import { NotificationType } from "../models/notifications.model";
import { GoalService, BookingSuggestion } from "../services/goal.service";
import { NotificationService } from "../services/notification.service";
import { logger } from "../utils/logger.utils";

interface ReminderContent {
  notificationType: NotificationType;
  title: string;
  message: string;
  emailBody: string;
  data: Record<string, unknown>;
}

class GoalReminderJob {
  private jobs: Map<string, CronJob> = new Map();

  initialize(): void {
    if (this.jobs.size > 0) {
      logger.warn("Goal reminder job already initialized");
      return;
    }

    this.startDailyReminderCheck();
    logger.info("Goal reminder jobs initialized", {
      jobCount: this.jobs.size,
    });
  }

  private startDailyReminderCheck(): void {
    const job = new CronJob(
      "0 9 * * *",
      async () => {
        logger.info("Running scheduled goal reminder check");
        await this.runDailyCheck();
      },
      null,
      false,
      "UTC",
    );

    job.start();
    this.jobs.set("goal-deadline-reminders", job);
    logger.info("Goal reminder job started (daily at 09:00 UTC)");
  }

  async runDailyCheck(): Promise<void> {
    const reminderTypes: GoalReminderType[] = ["7d", "3d", "1d", "overdue"];

    for (const reminderType of reminderTypes) {
      await this.processReminderType(reminderType);
    }
  }

  private async processReminderType(
    reminderType: GoalReminderType,
  ): Promise<void> {
    const goals = await GoalService.getGoalsDueForReminder(reminderType);

    for (const goal of goals) {
      try {
        await this.sendReminder(goal, reminderType);
        await GoalService.markReminderSent(goal.id, reminderType);
        goalRemindersSentTotal.labels(reminderType).inc();
      } catch (error) {
        logger.error("Failed to send goal reminder", {
          goalId: goal.id,
          learnerId: goal.learner_id,
          reminderType,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    logger.info("Processed goal reminder batch", {
      reminderType,
      goalCount: goals.length,
    });
  }

  private async sendReminder(
    goal: GoalReminderCandidate,
    reminderType: GoalReminderType,
  ): Promise<void> {
    const bookingSuggestion =
      reminderType === "overdue"
        ? await GoalService.getBookingSuggestion(goal)
        : null;
    const reminder = this.buildReminderContent(
      goal,
      reminderType,
      bookingSuggestion,
    );

    await NotificationService.createInAppNotification(
      goal.learner_id,
      reminder.notificationType,
      reminder.title,
      reminder.message,
      reminder.data,
    );

    if (this.shouldSendEmail(reminderType) && goal.learner_email) {
      await NotificationService.sendEmail({
        to: goal.learner_email,
        subject: reminder.title,
        body: reminder.emailBody,
      });
    }

    if (this.shouldSendPush(reminderType)) {
      await NotificationService.sendPush(
        goal.learner_id,
        reminder.title,
        reminder.message,
        reminder.data,
        bookingSuggestion?.booking_url,
      );
    }
  }

  private buildReminderContent(
    goal: GoalReminderCandidate,
    reminderType: GoalReminderType,
    bookingSuggestion: BookingSuggestion | null,
  ): ReminderContent {
    const learnerName = goal.learner_first_name || "there";
    const formattedDate = goal.target_date || "your deadline";
    const baseData: Record<string, unknown> = {
      type:
        reminderType === "overdue"
          ? NotificationType.GOAL_OVERDUE
          : NotificationType.GOAL_DEADLINE_REMINDER,
      goalId: goal.id,
      goalTitle: goal.title,
      targetDate: goal.target_date,
      progress: goal.progress,
      reminderType,
    };

    if (reminderType === "overdue") {
      const suggestionText = bookingSuggestion
        ? ` Suggested mentor: ${bookingSuggestion.first_name} ${bookingSuggestion.last_name} (${Math.round(
            bookingSuggestion.session_goal_alignment * 100,
          )}% alignment).`
        : "";

      return {
        notificationType: NotificationType.GOAL_OVERDUE,
        title: `Goal overdue: ${goal.title}`,
        message: `Your goal "${goal.title}" missed its ${formattedDate} deadline.${suggestionText}`,
        emailBody: `Hi ${learnerName},

Your goal "${goal.title}" is now overdue.
Deadline: ${formattedDate}
Current progress: ${goal.progress}%

${
  bookingSuggestion
    ? `To get back on track, consider booking a session with ${bookingSuggestion.first_name} ${bookingSuggestion.last_name} through the MentorMinds booking flow.`
    : "Consider booking a focused mentor session to get back on track."
}

MentorMinds`,
        data: {
          ...baseData,
          suggestedMentorId: bookingSuggestion?.id,
          suggestedMentorName: bookingSuggestion
            ? `${bookingSuggestion.first_name} ${bookingSuggestion.last_name}`
            : undefined,
          suggestedBookingUrl: bookingSuggestion?.booking_url,
        },
      };
    }

    const prefixByType: Record<Exclude<GoalReminderType, "overdue">, string> = {
      "7d": "7 days left",
      "3d": "3 days left",
      "1d": "1 day left",
    };

    return {
      notificationType: NotificationType.GOAL_DEADLINE_REMINDER,
      title: `${prefixByType[reminderType]} for ${goal.title}`,
      message: `Your goal "${goal.title}" is due on ${formattedDate}. Current progress: ${goal.progress}%.`,
      emailBody: `Hi ${learnerName},

This is a reminder that your goal "${goal.title}" is due on ${formattedDate}.
Current progress: ${goal.progress}%

Review your next milestone and, if needed, book time with your mentor before the deadline.

MentorMinds`,
      data: baseData,
    };
  }

  private shouldSendEmail(reminderType: GoalReminderType): boolean {
    return (
      reminderType === "3d" ||
      reminderType === "1d" ||
      reminderType === "overdue"
    );
  }

  private shouldSendPush(reminderType: GoalReminderType): boolean {
    return reminderType === "1d" || reminderType === "overdue";
  }

  stop(): void {
    for (const [name, job] of this.jobs.entries()) {
      job.stop();
      logger.info("Stopped goal reminder job", { name });
    }
    this.jobs.clear();
  }
}

export const goalReminderJob = new GoalReminderJob();
