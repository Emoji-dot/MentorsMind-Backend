import { describe, it, expect } from './test-harness';
import { getOraclePriceSchema } from '../schemas/oracle.schemas';
import { getTraceSchema } from '../schemas/trace.schemas';
import {
  disputeIdParamSchema,
  openDisputeSchema,
  resolveDisputeSchema,
} from '../schemas/disputes.schemas';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('getOraclePriceSchema', () => {
  it('accepts an alphanumeric asset symbol', () => {
    expect(getOraclePriceSchema.safeParse({ params: { asset: 'XLM' } }).success).toBe(true);
  });

  it('rejects an asset symbol with path-traversal characters', () => {
    expect(getOraclePriceSchema.safeParse({ params: { asset: '../../secret' } }).success).toBe(false);
  });

  it('rejects an oversized asset symbol', () => {
    expect(getOraclePriceSchema.safeParse({ params: { asset: 'A'.repeat(13) } }).success).toBe(false);
  });
});

describe('getTraceSchema', () => {
  it('accepts a 32-char hex traceId', () => {
    expect(getTraceSchema.safeParse({ params: { traceId: 'a'.repeat(32) } }).success).toBe(true);
  });

  it('rejects a malformed traceId', () => {
    expect(getTraceSchema.safeParse({ params: { traceId: 'not-a-trace-id' } }).success).toBe(false);
  });
});

describe('disputes schemas', () => {
  it('disputeIdParamSchema rejects a non-UUID id', () => {
    expect(disputeIdParamSchema.safeParse({ params: { id: '1; DROP TABLE disputes;' } }).success).toBe(false);
  });

  it('openDisputeSchema requires session_id, type, reason', () => {
    const result = openDisputeSchema.safeParse({
      body: { session_id: VALID_UUID, type: 'payment', reason: 'Session was not delivered as agreed.' },
    });
    expect(result.success).toBe(true);
  });

  it('openDisputeSchema rejects unknown extra fields (.strict())', () => {
    const result = openDisputeSchema.safeParse({
      body: {
        session_id: VALID_UUID,
        type: 'payment',
        reason: 'Session was not delivered.',
        isAdmin: true,
      },
    });
    expect(result.success).toBe(false);
  });

  it('resolveDisputeSchema rejects mentor_pct outside 0-100', () => {
    const result = resolveDisputeSchema.safeParse({
      params: { id: VALID_UUID },
      body: { mentor_pct: 150 },
    });
    expect(result.success).toBe(false);
  });
});
