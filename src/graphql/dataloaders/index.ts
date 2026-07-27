import DataLoader from "dataloader";
import { BookingModel, BookingRecord } from "../../models/booking.model";
import { PaymentModel, Payment } from "../../models/payment.model";
import { ReviewModel, Review } from "../../models/review.model";
import { WalletModel, Wallet } from "../../models/wallet.model";
import { UsersService } from "../../services/users.service";
import { MentorsService, MentorRecord } from "../../services/mentors.service";
import { PublicUserRecord } from "../../services/users.service";

export interface GraphQLLoaders {
  userLoader: DataLoader<string, PublicUserRecord | null>;
  mentorLoader: DataLoader<string, MentorRecord | null>;
  bookingLoader: DataLoader<string, BookingRecord[]>;
  paymentLoader: DataLoader<string, Payment[]>;
  reviewLoader: DataLoader<string, Review[]>;
  walletLoader: DataLoader<string, Wallet | null>;
}

export const createLoaders = (): GraphQLLoaders => ({
  userLoader: new DataLoader<string, PublicUserRecord | null>(async (ids) => {
    const uniqueIds = Array.from(new Set(ids));
    const users = await UsersService.findPublicByIds(uniqueIds);
    const userMap = new Map(users.map((u) => [u.id, u]));
    return ids.map((id) => userMap.get(id) || null);
  }),

  mentorLoader: new DataLoader<string, MentorRecord | null>(async (ids) => {
    const uniqueIds = Array.from(new Set(ids));
    const mentors = await MentorsService.findByIds(uniqueIds);
    const mentorMap = new Map(mentors.map((m) => [m.id, m]));
    return ids.map((id) => mentorMap.get(id) || null);
  }),

  bookingLoader: new DataLoader<string, BookingRecord[]>(async (ids) => {
    const uniqueIds = Array.from(new Set(ids));
    const allBookings = await BookingModel.findByUserIds(uniqueIds);

    const grouped = new Map<string, BookingRecord[]>();
    uniqueIds.forEach((id) => grouped.set(id, []));

    allBookings.forEach((booking) => {
      if (grouped.has(booking.mentee_id)) {
        grouped.get(booking.mentee_id)!.push(booking);
      }
      if (grouped.has(booking.mentor_id)) {
        grouped.get(booking.mentor_id)!.push(booking);
      }
    });

    return ids.map((id) => grouped.get(id) || []);
  }),

  paymentLoader: new DataLoader<string, Payment[]>(async (ids) => {
    const uniqueIds = Array.from(new Set(ids));
    const rows = await PaymentModel.findByUserIds(uniqueIds);

    const grouped: Record<string, Payment[]> = Object.create(null);
    for (const id of uniqueIds) grouped[id] = [];
    for (const row of rows) {
      if (typeof row.user_id === "string" && grouped[row.user_id]) {
        grouped[row.user_id].push(row);
      }
    }

    return ids.map((id) => grouped[id] ?? []);
  }),

  reviewLoader: new DataLoader<string, Review[]>(async (ids) => {
    const uniqueIds = Array.from(new Set(ids));
    const rows = await ReviewModel.findByUserIds(uniqueIds);

    const grouped: Record<string, Review[]> = Object.create(null);
    for (const id of uniqueIds) grouped[id] = [];

    for (const row of rows) {
      // A review can match as either reviewer_id or reviewee_id.
      if (typeof row.reviewer_id === "string" && grouped[row.reviewer_id]) {
        grouped[row.reviewer_id].push(row);
      }
      if (typeof row.reviewee_id === "string" && grouped[row.reviewee_id]) {
        grouped[row.reviewee_id].push(row);
      }
    }

    // Keep ordering consistent with requested ids.
    return ids.map((id) => grouped[id] ?? []);
  }),

  walletLoader: new DataLoader<string, Wallet | null>(async (userIds) => {
    const uniqueIds = Array.from(new Set(userIds));
    const wallets = await WalletModel.findByUserIds(uniqueIds);
    const walletMap = new Map(wallets.map((w) => [w.user_id, w]));
    return userIds.map((id) => walletMap.get(id) || null);
  }),
});
