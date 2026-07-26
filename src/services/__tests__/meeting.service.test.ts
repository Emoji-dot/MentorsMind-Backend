/**
 * Meeting Service — token generation tests
 *
 * Tests each provider's generateToken implementation in isolation using:
 *   - In-memory overrides of meetingConfig (no real .env required)
 *   - axios.post stub (no real network calls)
 *   - jsonwebtoken.verify to assert that generated JWTs are valid
 *
 * Run via:  npm run test:meeting
 */

import jwt from 'jsonwebtoken';
import axios from 'axios';
import { describe, it, expect } from './meeting-test-harness';
import meetingConfig, { MeetingProvider } from '../../config/meeting.config';
import { MeetingService } from '../meeting.service';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Override meetingConfig properties for a single test then restore them. */
function withConfig<T>(overrides: Partial<typeof meetingConfig>, fn: () => T): T {
  const saved: Partial<typeof meetingConfig> = {};
  for (const key of Object.keys(overrides) as Array<keyof typeof meetingConfig>) {
    saved[key] = meetingConfig[key] as never;
    (meetingConfig as Record<string, unknown>)[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved) as Array<keyof typeof meetingConfig>) {
      (meetingConfig as Record<string, unknown>)[key] = saved[key];
    }
  }
}

/** Stub axios.post to return a fixed response, then restore it. */
function withAxiosStub(
  stubbedResponse: Record<string, unknown>,
  fn: () => Promise<unknown>
): Promise<unknown> {
  const original = axios.post;
  (axios as { post: unknown }).post = async () => ({ data: stubbedResponse });
  return fn().finally(() => {
    (axios as { post: unknown }).post = original;
  });
}

const ROOM_ID = 'test-room-abc123';
const PARTICIPANT = 'Alice';

// ─── Zoom ────────────────────────────────────────────────────────────────────

describe('generateToken — Zoom — valid JWT', () => {
  it('returns a non-empty JWT string', async () => {
    const result = await withConfig(
      {
        provider: MeetingProvider.ZOOM,
        zoomSdkKey: 'zoom_sdk_key_test',
        zoomSdkSecret: 'zoom_sdk_secret_test_32chars_min!!',
      },
      () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
    );

    expect(result.token).not.toBeNull();
    expect(typeof result.token).toBe('string');
    expect((result.token as string).length).toBeGreaterThan(0);
  });

  it('produces a JWT verifiable with ZOOM_SDK_SECRET', async () => {
    const sdkSecret = 'zoom_sdk_secret_test_32chars_min!!';
    const result = await withConfig(
      {
        provider: MeetingProvider.ZOOM,
        zoomSdkKey: 'zoom_sdk_key_test',
        zoomSdkSecret: sdkSecret,
      },
      () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
    );

    const decoded = jwt.verify(result.token as string, sdkSecret, {
      algorithms: ['HS256'],
    }) as Record<string, unknown>;

    expect(decoded.app_key).toBe('zoom_sdk_key_test');
    expect(decoded.tpc).toBe(ROOM_ID);
    expect(decoded.user_identity).toBe(PARTICIPANT);
    expect(decoded.role_type).toBe(0);
  });

  it('includes a future token_expiry', async () => {
    const result = await withConfig(
      {
        provider: MeetingProvider.ZOOM,
        zoomSdkKey: 'zoom_sdk_key_test',
        zoomSdkSecret: 'zoom_sdk_secret_test_32chars_min!!',
      },
      () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
    );

    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(result.tokenExpiry).not.toBeNull();
    expect(result.tokenExpiry as number).toBeGreaterThan(nowSeconds);
  });

  it('throws when ZOOM_SDK_KEY is missing', async () => {
    let threw = false;
    try {
      await withConfig(
        {
          provider: MeetingProvider.ZOOM,
          zoomSdkKey: undefined,
          zoomSdkSecret: 'zoom_sdk_secret_test_32chars_min!!',
        },
        () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
      );
    } catch {
      threw = true;
    }
    expect(threw).toBeTruthy();
  });

  it('throws when ZOOM_SDK_SECRET is missing', async () => {
    let threw = false;
    try {
      await withConfig(
        {
          provider: MeetingProvider.ZOOM,
          zoomSdkKey: 'zoom_sdk_key_test',
          zoomSdkSecret: undefined,
        },
        () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
      );
    } catch {
      threw = true;
    }
    expect(threw).toBeTruthy();
  });
});

// ─── Whereby ─────────────────────────────────────────────────────────────────

describe('generateToken — Whereby — host token via API', () => {
  it('calls /meetings/:roomId/host and returns the token', async () => {
    const fakeToken = 'whereby-host-token-xyz';
    let capturedUrl: string | undefined;

    const originalPost = axios.post;
    (axios as { post: unknown }).post = async (url: string) => {
      capturedUrl = url as string;
      return { data: { token: fakeToken } };
    };

    let result;
    try {
      result = await withConfig(
        {
          provider: MeetingProvider.WHEREBY,
          wherebyApiKey: 'whereby_api_key_test',
          baseUrl: 'https://api.whereby.dev/v1',
        },
        () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
      );
    } finally {
      (axios as { post: unknown }).post = originalPost;
    }

    expect(result.token).toBe(fakeToken);
    expect(capturedUrl as string).toContain(ROOM_ID);
    expect(capturedUrl as string).toContain('/host');
  });

  it('includes a future token_expiry', async () => {
    const fakeToken = 'whereby-host-token-xyz';
    let result;
    await withAxiosStub({ token: fakeToken }, async () => {
      result = await withConfig(
        {
          provider: MeetingProvider.WHEREBY,
          wherebyApiKey: 'whereby_api_key_test',
          baseUrl: 'https://api.whereby.dev/v1',
          roomExpiryMinutes: 30,
        },
        () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
      );
    });

    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(result!.tokenExpiry).not.toBeNull();
    expect(result!.tokenExpiry as number).toBeGreaterThan(nowSeconds);
  });

  it('falls back to MEETING_API_KEY when WHEREBY_API_KEY is absent', async () => {
    let capturedAuthHeader: string | undefined;

    const originalPost = axios.post;
    (axios as { post: unknown }).post = async (_url: string, _data: unknown, options: { headers: Record<string, string> }) => {
      capturedAuthHeader = options.headers['Authorization'];
      return { data: { token: 'tok' } };
    };

    try {
      await withConfig(
        {
          provider: MeetingProvider.WHEREBY,
          wherebyApiKey: undefined,
          apiKey: 'fallback_api_key',
          baseUrl: 'https://api.whereby.dev/v1',
        },
        () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
      );
    } finally {
      (axios as { post: unknown }).post = originalPost;
    }

    expect(capturedAuthHeader).toContain('fallback_api_key');
  });

  it('rejects when both WHEREBY_API_KEY and MEETING_API_KEY are empty', async () => {
    let threw = false;
    try {
      await withConfig(
        {
          provider: MeetingProvider.WHEREBY,
          wherebyApiKey: undefined,
          apiKey: '',
          baseUrl: 'https://api.whereby.dev/v1',
        },
        () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
      );
    } catch {
      threw = true;
    }
    expect(threw).toBeTruthy();
  });
});

// ─── Jitsi ───────────────────────────────────────────────────────────────────

describe('generateToken — Jitsi — JWT when secret configured', () => {
  it('returns a non-null token when JITSI_JWT_SECRET is set', async () => {
    const result = await withConfig(
      {
        provider: MeetingProvider.JITSI,
        jitsiJwtSecret: 'jitsi_jwt_secret_test_32chars_min!!',
        jitsiAppId: 'mentorminds',
      },
      () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
    );

    expect(result.token).not.toBeNull();
    expect(typeof result.token).toBe('string');
  });

  it('produces a JWT verifiable with JITSI_JWT_SECRET', async () => {
    const jwtSecret = 'jitsi_jwt_secret_test_32chars_min!!';
    const appId = 'mentorminds';

    const result = await withConfig(
      {
        provider: MeetingProvider.JITSI,
        jitsiJwtSecret: jwtSecret,
        jitsiAppId: appId,
      },
      () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
    );

    const decoded = jwt.verify(result.token as string, jwtSecret, {
      algorithms: ['HS256'],
    }) as Record<string, unknown>;

    expect(decoded.iss).toBe(appId);
    expect(decoded.room).toBe(ROOM_ID);
    const context = decoded.context as { user: { name: string } };
    expect(context.user.name).toBe(PARTICIPANT);
  });

  it('includes a future token_expiry', async () => {
    const result = await withConfig(
      {
        provider: MeetingProvider.JITSI,
        jitsiJwtSecret: 'jitsi_jwt_secret_test_32chars_min!!',
        jitsiAppId: 'mentorminds',
      },
      () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
    );

    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(result.tokenExpiry).not.toBeNull();
    expect(result.tokenExpiry as number).toBeGreaterThan(nowSeconds);
  });
});

describe('generateToken — Jitsi — not_required when no secret', () => {
  it('returns token: null when JITSI_JWT_SECRET is absent', async () => {
    const result = await withConfig(
      {
        provider: MeetingProvider.JITSI,
        jitsiJwtSecret: undefined,
      },
      () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
    );

    expect(result.token).toBeNull();
    expect(result.tokenExpiry).toBeNull();
    expect(result.reason).toBe('not_required');
  });
});

// ─── Daily.co ─────────────────────────────────────────────────────────────────

describe('generateToken — Daily.co — API-issued token', () => {
  it('returns the token from the Daily API response', async () => {
    const fakeToken = 'daily-meeting-token-abc';
    let result;
    await withAxiosStub({ token: fakeToken }, async () => {
      result = await withConfig(
        {
          provider: MeetingProvider.DAILY,
          apiKey: 'daily_api_key_test',
          baseUrl: 'https://api.daily.co/v1',
        },
        () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
      );
    });

    expect(result!.token).toBe(fakeToken);
  });

  it('includes a future token_expiry', async () => {
    let result;
    await withAxiosStub({ token: 'daily-tok' }, async () => {
      result = await withConfig(
        {
          provider: MeetingProvider.DAILY,
          apiKey: 'daily_api_key_test',
          baseUrl: 'https://api.daily.co/v1',
        },
        () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
      );
    });

    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(result!.tokenExpiry as number).toBeGreaterThan(nowSeconds);
  });
});

// ─── GenerateTokenResult shape ───────────────────────────────────────────────

describe('GenerateTokenResult — shape', () => {
  it('Zoom result has token, tokenExpiry, no reason field when successful', async () => {
    const result = await withConfig(
      {
        provider: MeetingProvider.ZOOM,
        zoomSdkKey: 'k',
        zoomSdkSecret: 'zoom_sdk_secret_min_32_chars_okay!!',
      },
      () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
    );

    expect(result.token !== null).toBeTruthy();
    expect(result.tokenExpiry !== null).toBeTruthy();
    // reason is undefined when token is present
    expect(result.reason === undefined).toBeTruthy();
  });

  it('Jitsi (no secret) result has token: null, reason: not_required', async () => {
    const result = await withConfig(
      { provider: MeetingProvider.JITSI, jitsiJwtSecret: undefined },
      () => MeetingService.generateToken(ROOM_ID, PARTICIPANT)
    );

    expect(result.token).toBeNull();
    expect(result.reason).toBe('not_required');
  });
});
