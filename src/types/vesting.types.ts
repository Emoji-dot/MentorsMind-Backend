/**
 * TypeScript bindings for the Soroban Vesting Contract
 * Generated from contracts/vesting/src/lib.rs
 */

export interface VestingSchedule {
  beneficiary: string; // Stellar address
  total: bigint; // Total vesting amount in stroops
  claimed: bigint; // Amount already claimed in stroops
  cliff_end: number; // Unix timestamp (seconds)
  vesting_end: number; // Unix timestamp (seconds)
  start: number; // Unix timestamp (seconds)
}

export interface CreateVestingScheduleParams {
  beneficiary: string; // Stellar address
  totalAmount: bigint; // Total amount in stroops
  cliffSeconds: number; // Cliff duration in seconds
  vestingSeconds: number; // Total vesting duration in seconds
  start: number; // Start timestamp (0 = use current time)
}

export interface VestingScheduleCreatedEvent {
  schedule_id: number;
  beneficiary: string;
  total_amount: bigint;
  cliff_end: number;
  vesting_end: number;
  start: number;
}

export interface TokensClaimedEvent {
  schedule_id: number;
  beneficiary: string;
  amount: bigint;
}

export interface ScheduleRevokedEvent {
  schedule_id: number;
  beneficiary: string;
  refunded_amount: bigint;
}

/**
 * Vesting contract constants (from lib.rs)
 */
export const VESTING_CONSTANTS = {
  MIN_CLIFF_SECS: 3600, // 1 hour
  MIN_VESTING_SECS: 86400, // 1 day (24 hours)
  MAX_VESTING_SECS: 315360000, // 10 years
  TIMESTAMP_TOLERANCE_SECS: 60, // 1 minute
  MAX_PAST_START_SECS: 300, // 5 minutes
} as const;

/**
 * Vesting contract methods
 */
export type VestingContractMethod =
  | 'initialize'
  | 'create_schedule'
  | 'claim'
  | 'revoke'
  | 'claimable_amount'
  | 'get_schedule'
  | 'get_schedules_by_beneficiary';

/**
 * Vesting schedule status (backend mirror table)
 */
export type VestingScheduleStatus = 'active' | 'revoked' | 'completed';

/**
 * Vesting schedule type categories
 */
export type VestingType =
  | 'team'
  | 'advisor'
  | 'mentor_grant'
  | 'investor'
  | 'early_contributor'
  | 'partnership'
  | 'community_grant'
  | 'other';

/**
 * Database model for vesting_schedules table
 */
export interface VestingScheduleModel {
  id: number;
  schedule_id: number;
  beneficiary_address: string;
  beneficiary_user_id?: string;
  total_amount: string; // Stored as string to avoid BigInt serialization issues
  claimed_amount: string;
  cliff_end_timestamp: number;
  vesting_end_timestamp: number;
  start_timestamp: number;
  contract_address: string;
  status: VestingScheduleStatus;
  vesting_type: VestingType;
  notes?: string;
  created_by?: string;
  revoked_by?: string;
  revoked_at?: Date;
  created_at: Date;
  updated_at: Date;
  last_synced_at: Date;
}

/**
 * Database model for vesting_claims table
 */
export interface VestingClaimModel {
  id: number;
  schedule_id: number;
  amount_claimed: string;
  claimed_at: Date;
  tx_hash?: string;
  beneficiary_address: string;
  notes?: string;
}

/**
 * Database model for vesting_sync_log table
 */
export interface VestingSyncLogModel {
  id: number;
  sync_started_at: Date;
  sync_completed_at?: Date;
  schedules_synced: number;
  schedules_failed: number;
  error_message?: string;
  sync_duration_ms?: number;
}

/**
 * API response types
 */
export interface VestingScheduleResponse {
  scheduleId: number;
  beneficiaryAddress: string;
  beneficiaryUserId?: string;
  totalAmount: string; // In stroops
  claimedAmount: string; // In stroops
  cliffEnd: number; // Unix timestamp
  vestingEnd: number; // Unix timestamp
  start: number; // Unix timestamp
  contractAddress: string;
  status: VestingScheduleStatus;
  vestingType: VestingType;
  notes?: string;
  claimableNow: string; // Calculated claimable amount
  claimablePercent: number; // Percentage vested
  isCliffPassed: boolean;
  isFullyVested: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt: Date;
}

export interface VestingClaimResponse {
  scheduleId: number;
  amountClaimed: string;
  claimedAt: Date;
  txHash?: string;
  beneficiaryAddress: string;
}

/**
 * API request types
 */
export interface CreateVestingScheduleRequest {
  beneficiaryAddress: string;
  totalAmount: string; // In stroops or XLM (will be converted)
  cliffDuration: number; // In seconds
  vestingDuration: number; // In seconds
  startTimestamp?: number; // Optional start time (0 or undefined = now)
  vestingType: VestingType;
  notes?: string;
  beneficiaryUserId?: string; // Optional link to user
}

export interface ClaimVestingRequest {
  scheduleId: number;
}

export interface RevokeVestingScheduleRequest {
  scheduleId: number;
  reason?: string;
}

/**
 * Error types
 */
export enum VestingErrorCode {
  ALREADY_INITIALIZED = 1,
  NOT_INITIALIZED = 2,
  UNAUTHORIZED = 3,
  INVALID_SCHEDULE = 4,
  NOTHING_TO_CLAIM = 5,
  SCHEDULE_NOT_FOUND = 6,
  INSUFFICIENT_BALANCE = 7,
}

export class VestingError extends Error {
  constructor(
    public code: VestingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VestingError';
  }
}

/**
 * Utility functions for vesting calculations
 */
export const VestingUtils = {
  /**
   * Convert XLM to stroops
   */
  xlmToStroops(xlm: number): bigint {
    return BigInt(Math.floor(xlm * 10_000_000));
  },

  /**
   * Convert stroops to XLM
   */
  stroopsToXlm(stroops: bigint): number {
    return Number(stroops) / 10_000_000;
  },

  /**
   * Calculate claimable amount based on current time
   */
  calculateClaimableAmount(
    schedule: VestingSchedule,
    currentTimestamp: number,
  ): bigint {
    const { total, claimed, cliff_end, vesting_end } = schedule;

    // Apply tolerance: require current_time to exceed cliff_end by at least TIMESTAMP_TOLERANCE_SECS
    if (
      currentTimestamp <
      cliff_end + VESTING_CONSTANTS.TIMESTAMP_TOLERANCE_SECS
    ) {
      return 0n;
    }

    // If fully vested, return remaining amount
    if (currentTimestamp >= vesting_end) {
      return total - claimed;
    }

    // Linear vesting between cliff and end
    const vestedPeriod =
      BigInt(currentTimestamp) - BigInt(cliff_end) - BigInt(VESTING_CONSTANTS.TIMESTAMP_TOLERANCE_SECS);
    const totalPeriod = BigInt(vesting_end) - BigInt(cliff_end);
    const vestedAmount = (total * vestedPeriod) / totalPeriod;

    return vestedAmount - claimed;
  },

  /**
   * Calculate vesting percentage
   */
  calculateVestingPercent(
    schedule: VestingSchedule,
    currentTimestamp: number,
  ): number {
    const { cliff_end, vesting_end, start } = schedule;

    if (currentTimestamp < cliff_end) {
      return 0;
    }

    if (currentTimestamp >= vesting_end) {
      return 100;
    }

    const elapsed = currentTimestamp - start;
    const total = vesting_end - start;
    return (elapsed / total) * 100;
  },

  /**
   * Validate cliff and vesting durations
   */
  validateDurations(
    cliffSeconds: number,
    vestingSeconds: number,
  ): { valid: boolean; error?: string } {
    if (
      cliffSeconds !== 0 &&
      cliffSeconds < VESTING_CONSTANTS.MIN_CLIFF_SECS
    ) {
      return {
        valid: false,
        error: `Cliff duration must be 0 or at least ${VESTING_CONSTANTS.MIN_CLIFF_SECS} seconds (1 hour)`,
      };
    }

    if (vestingSeconds < VESTING_CONSTANTS.MIN_VESTING_SECS) {
      return {
        valid: false,
        error: `Vesting duration must be at least ${VESTING_CONSTANTS.MIN_VESTING_SECS} seconds (1 day)`,
      };
    }

    if (vestingSeconds > VESTING_CONSTANTS.MAX_VESTING_SECS) {
      return {
        valid: false,
        error: `Vesting duration cannot exceed ${VESTING_CONSTANTS.MAX_VESTING_SECS} seconds (10 years)`,
      };
    }

    if (cliffSeconds > vestingSeconds) {
      return {
        valid: false,
        error: 'Cliff duration cannot be longer than total vesting duration',
      };
    }

    return { valid: true };
  },

  /**
   * Format timestamp to readable date
   */
  formatTimestamp(timestamp: number): string {
    return new Date(timestamp * 1000).toISOString();
  },
};
