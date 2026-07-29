/**
 * Session Reminder Job — Issue #100
 *
 * Runs every 5 minutes via BullMQ repeatable job.
 * Sends 24-hour and 15-minute reminders (email + in-app) to both
 * mentor and mentee for confirmed upcoming bookings.
 * Uses reminder_24h_sent / reminder_15m_sent flags to prevent duplicates.
 */

import { DateTime } from "luxon";
import pool from "../config/database";
import { enqueueEmail } from "../queues/email.queue";
import {
  NotificationService,
  NotificationChannel,
  NotificationPriority,
} from "../services/notification.service";
import { NotificationType } from "../models/notifications.model";
import { logger } from "../utils/logger.utils";

/**
 * Whitelist of allowed flag columns to prevent SQL injection.
 * Maps reminder type to safe column name.
 */
const ALLOWED_FLAG_COLUMNS = {
  "24h": "reminder_24h_sent",
  "15m": "reminder_15m_sent",
  "1h_mentee": "reminder_1h_sent_mentee",
  "1h_mentor": "reminder_1h_sent_mentor",
} as const;

type FlagColumnType = keyof typeof ALLOWED_FLAG_COLUMNS;

/**
 * Validates a flag column against the whitelist.
 * Throws an error if the column is not in the allowed list.
 */
function _validateFlagColumn(column: string): asserts column is FlagColumnType {
  if (!Object.values(ALLOWED_FLAG_COLUMNS).includes(column as any)) {
    throw new Error(
      `Invalid flag column: ${column}. Allowed values: ${Object.values(ALLOWED_FLAG_COLUMNS).join(", ")}`,
    );
  }
}

interface ReminderBooking {
  id: string;
  mentor_id: string;
  mentee_id: string;
  mentor_email: string;
  mentee_email: string;
  mentor_first_name: string;
  mentee_first_name: string;
  mentor_timezone: string | null;
  mentee_timezone: string | null;
  title: string;
  scheduled_start: Date;
  duration_minutes: number;
  meeting_url: string | null;
}

/**
 * Fetch bookings due for a reminder within the given window.
 * Only returns confirmed, non-cancelled bookings where the flag is still false.
 * @param flagColumn - Must be validated against ALLOWED_FLAG_COLUMNS
 */
async function fetchDueBookings(
  windowStart: string,
  windowEnd: string,
  flagColumn: keyof typeof ALLOWED_FLAG_COLUMNS,
): Promise<ReminderBooking[]> {
  // Validate column name against whitelist to prevent SQL injection
  const safeColumnName = ALLOWED_FLAG_COLUMNS[flagColumn];
  if (!safeColumnName) {
    throw new Error(`Invalid flag column: ${flagColumn}`);
  }

  const { rows } = await pool.query<ReminderBooking>(
    `SELECT
       b.id,
       b.mentor_id,
       b.mentee_id,
       mentor.email        AS mentor_email,
       mentee.email        AS mentee_email,
       mentor.first_name   AS mentor_first_name,
       mentee.first_name   AS mentee_first_name,
       mentor.timezone     AS mentor_timezone,
       mentee.timezone     AS mentee_timezone,
       b.title,
       b.scheduled_start,
       b.duration_minutes,
       b.meeting_url
     FROM bookings b
     JOIN users mentor ON mentor.id = b.mentor_id
     JOIN users mentee ON mentee.id = b.mentee_id
     WHERE b.status = 'confirmed'
       AND b.${safeColumnName} = FALSE
       AND b.scheduled_start BETWEEN $1 AND $2`,
    [windowStart, windowEnd],
  );
  return rows;
}

/**
 * Mark the reminder flag as sent for a booking.
 * @param flagColumn - Must be validated against ALLOWED_FLAG_COLUMNS
 */
async function markReminderSent(
  bookingId: string,
  flagColumn: keyof typeof ALLOWED_FLAG_COLUMNS,
): Promise<void> {
  // Validate column name against whitelist to prevent SQL injection
  const safeColumnName = ALLOWED_FLAG_COLUMNS[flagColumn];
  if (!safeColumnName) {
    throw new Error(`Invalid flag column: ${flagColumn}`);
  }

  await pool.query(
    `UPDATE bookings SET ${safeColumnName} = TRUE, updated_at = NOW() WHERE id = $1`,
    [bookingId],
  );
}

/**
 * Send email + in-app notification to a single recipient for a session reminder.
 */
async function sendReminderToUser(
  userId: string,
  userEmail: string,
  firstName: string,
  userTimezone: string | null,
  booking: ReminderBooking,
  reminderType: "24h" | "1h" | "15m",
): Promise<void> {
  const timeLabel = reminderType === "24h" ? "24 hours" : reminderType === "1h" ? "1 hour" : "15 minutes";
  const subject = `Reminder: Your session "${booking.title}" starts in ${timeLabel}`;
  
  const timezone = userTimezone || "UTC";
  const sessionTime = DateTime.fromJSDate(booking.scheduled_start).setZone(timezone).toFormat('fff'); // e.g. "Oct 14, 1983, 1:30 PM EDT"

  // Email reminder
  await enqueueEmail({
    to: [userEmail],
    subject,
    htmlContent: `
      <p>Hi ${firstName},</p>
      <p>This is a reminder that your mentorship session <strong>"${booking.title}"</strong>
         starts in <strong>${timeLabel}</strong>.</p>
      <p><strong>Scheduled:</strong> ${sessionTime} (${timezone})</p>
      <p><strong>Duration:</strong> ${booking.duration_minutes} minutes</p>
      ${booking.meeting_url ? `<p><strong>Meeting link:</strong> <a href="${booking.meeting_url}">${booking.meeting_url}</a></p>` : ""}
      <p>See you there!</p>
    `,
    textContent: `Hi ${firstName}, your session "${booking.title}" starts in ${timeLabel} at ${sessionTime} (${timezone}).${booking.meeting_url ? ` Join here: ${booking.meeting_url}` : ""}`,
    priority: reminderType === "15m" ? "high" : "normal",
  });

  // In-app notification
  await NotificationService.sendNotification({
    userId,
    type: NotificationType.SESSION_REMINDER,
    channels: [NotificationChannel.IN_APP],
    priority:
      reminderType === "15m"
        ? NotificationPriority.HIGH
        : NotificationPriority.NORMAL,
    title: `Session in ${timeLabel}`,
    message: `Your session "${booking.title}" starts in ${timeLabel}.`,
    data: {
      bookingId: booking.id,
      scheduledStart: booking.scheduled_start,
      meetingUrl: booking.meeting_url,
      reminderType,
    },
  });
}

/**
 * Process reminders for a given window.
 */
async function processReminders(
  windowStart: string,
  windowEnd: string,
  flagColumn: keyof typeof ALLOWED_FLAG_COLUMNS,
  reminderType: "24h" | "1h" | "15m",
  targetRole?: "mentor" | "mentee",
): Promise<void> {
  const bookings = await fetchDueBookings(windowStart, windowEnd, flagColumn);

  if (bookings.length === 0) return;

  logger.info(`[SessionReminder] Processing ${reminderType} reminders`, {
    count: bookings.length,
    targetRole
  });

  for (const booking of bookings) {
    try {
      const promises = [];
      
      if (!targetRole || targetRole === "mentor") {
        promises.push(sendReminderToUser(
          booking.mentor_id,
          booking.mentor_email,
          booking.mentor_first_name,
          booking.mentor_timezone,
          booking,
          reminderType,
        ));
      }
      
      if (!targetRole || targetRole === "mentee") {
        promises.push(sendReminderToUser(
          booking.mentee_id,
          booking.mentee_email,
          booking.mentee_first_name,
          booking.mentee_timezone,
          booking,
          reminderType,
        ));
      }

      await Promise.all(promises);

      await markReminderSent(booking.id, flagColumn);

      logger.info(`[SessionReminder] ${reminderType} reminder sent`, {
        sessionId: booking.id,
        mentorId: booking.mentor_id,
        menteeId: booking.mentee_id,
      });
    } catch (err) {
      logger.error(
        `[SessionReminder] Failed to send ${reminderType} reminder`,
        {
          sessionId: booking.id,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      // Continue processing remaining bookings — don't let one failure block others
    }
  }
}

/**
 * Main entry point — called by the BullMQ worker every 5 minutes.
 */
export async function runSessionReminderJob(): Promise<void> {
  const now = DateTime.utc();

  // 24-hour window: sessions starting between now+23h and now+25h
  const window24hStart = now.plus({ hours: 23 }).toISO();
  const window24hEnd = now.plus({ hours: 25 }).toISO();

  // 1-hour window: sessions starting between now+50m and now+70m
  const window1hStart = now.plus({ minutes: 50 }).toISO();
  const window1hEnd = now.plus({ minutes: 70 }).toISO();

  // 15-minute window: sessions starting between now+10m and now+20m
  const window15mStart = now.plus({ minutes: 10 }).toISO();
  const window15mEnd = now.plus({ minutes: 20 }).toISO();

  await Promise.all([
    processReminders(window24hStart!, window24hEnd!, "24h", "24h"),
    processReminders(window1hStart!, window1hEnd!, "1h_mentor", "1h", "mentor"),
    processReminders(window1hStart!, window1hEnd!, "1h_mentee", "1h", "mentee"),
    processReminders(window15mStart!, window15mEnd!, "15m", "15m"),
  ]);
}
