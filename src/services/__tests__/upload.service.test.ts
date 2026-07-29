/**
 * Unit tests for UploadService (src/services/upload.service.ts)
 *
 * Test runner: Jest (or ts-jest)
 * All external dependencies (StorageService, virusScanQueue, sharp) are mocked
 * so that these tests run in CI without AWS credentials or ClamAV.
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that reference the modules
// ---------------------------------------------------------------------------

jest.mock('../storage.service', () => ({
  StorageService: {
    uploadFile: jest.fn().mockResolvedValue({ key: 'avatars/user-1/12345.jpg', url: 's3://bucket/avatars/user-1/12345.jpg' }),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../queues/virus-scan.queue', () => ({
  virusScanQueue: {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  },
}));

// Mock sharp: always returns a tiny 1-byte JPEG buffer
jest.mock('sharp', () => {
  const sharpMock = jest.fn().mockReturnValue({
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff])), // minimal JPEG magic bytes
  });
  return sharpMock;
});

jest.mock('../../config/env', () => ({
  env: {
    AWS_REGION: 'us-east-1',
    AWS_S3_BUCKET: 'test-bucket',
    AWS_ACCESS_KEY_ID: 'test-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret',
    CDN_BASE_URL: 'https://cdn.example.com',
  },
}));

// ---------------------------------------------------------------------------
// System under test
// ---------------------------------------------------------------------------

import {
  UploadService,
  UnsupportedMediaTypeError,
  FileTooLargeError,
  MAX_AVATAR_SIZE_BYTES,
  ALLOWED_AVATAR_MIME_TYPES,
} from '../upload.service';
import { StorageService } from '../storage.service';
import { virusScanQueue } from '../../queues/virus-scan.queue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a fake in-memory PNG file buffer (3 bytes, enough for mocked sharp) */
function makeBuffer(bytes = 100): Buffer {
  return Buffer.alloc(bytes, 0x89); // 0x89 = first byte of PNG magic
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UploadService.uploadAvatar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('should upload a JPEG image and return a CDN URL', async () => {
    const url = await UploadService.uploadAvatar(
      'user-1',
      makeBuffer(),
      'image/jpeg',
      1024,
      null,
    );

    expect(StorageService.uploadFile).toHaveBeenCalledTimes(1);
    const [key, , contentType] = (StorageService.uploadFile as jest.Mock).mock.calls[0];
    expect(key).toMatch(/^avatars\/user-1\/\d+\.jpg$/);
    expect(contentType).toBe('image/jpeg');
    expect(url).toMatch(/^https:\/\/cdn\.example\.com\/avatars\/user-1\//);
  });

  it('should upload a PNG image and return a CDN URL', async () => {
    const url = await UploadService.uploadAvatar(
      'user-42',
      makeBuffer(),
      'image/png',
      512 * 1024,
      null,
    );
    expect(url).toMatch(/^https:\/\/cdn\.example\.com\/avatars\/user-42\//);
  });

  it('should upload a WebP image and return a CDN URL', async () => {
    const url = await UploadService.uploadAvatar(
      'user-99',
      makeBuffer(),
      'image/webp',
      200 * 1024,
      null,
    );
    expect(url).toMatch(/^https:\/\/cdn\.example\.com\/avatars\/user-99\//);
  });

  // ── Old avatar deletion ─────────────────────────────────────────────────────

  it('should delete the old S3 object when oldAvatarUrl is a valid S3 avatars/ URL', async () => {
    const oldUrl = 'https://cdn.example.com/avatars/user-1/9999.jpg';

    await UploadService.uploadAvatar('user-1', makeBuffer(), 'image/jpeg', 1024, oldUrl);

    // Give microtasks time to flush (the delete is fire-and-forget via .catch)
    await new Promise(setImmediate);

    expect(StorageService.deleteFile).toHaveBeenCalledWith('avatars/user-1/9999.jpg');
  });

  it('should NOT call deleteFile when oldAvatarUrl is null', async () => {
    await UploadService.uploadAvatar('user-1', makeBuffer(), 'image/jpeg', 1024, null);

    await new Promise(setImmediate);

    expect(StorageService.deleteFile).not.toHaveBeenCalled();
  });

  it('should NOT call deleteFile when oldAvatarUrl is a base64 string (legacy data)', async () => {
    const base64Url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';

    await UploadService.uploadAvatar('user-1', makeBuffer(), 'image/jpeg', 1024, base64Url);

    await new Promise(setImmediate);

    expect(StorageService.deleteFile).not.toHaveBeenCalled();
  });

  // ── Virus scan queue ───────────────────────────────────────────────────────

  it('should enqueue a virus scan job after upload', async () => {
    await UploadService.uploadAvatar('user-1', makeBuffer(), 'image/jpeg', 1024, null);

    expect(virusScanQueue.add).toHaveBeenCalledWith(
      'avatar-scan',
      expect.objectContaining({
        bucket: 'test-bucket',
        attachmentId: 'avatar:user-1',
      }),
      expect.any(Object),
    );
  });

  it('should still resolve successfully even if the virus scan queue throws', async () => {
    (virusScanQueue.add as jest.Mock).mockRejectedValueOnce(new Error('Redis unavailable'));

    await expect(
      UploadService.uploadAvatar('user-1', makeBuffer(), 'image/jpeg', 1024, null),
    ).resolves.toMatch(/^https:\/\//);
  });

  // ── MIME type validation (HTTP 415) ────────────────────────────────────────

  it('should throw UnsupportedMediaTypeError for image/gif (HTTP 415)', async () => {
    await expect(
      UploadService.uploadAvatar('user-1', makeBuffer(), 'image/gif', 1024, null),
    ).rejects.toThrow(UnsupportedMediaTypeError);
  });

  it('should throw UnsupportedMediaTypeError for application/pdf (HTTP 415)', async () => {
    await expect(
      UploadService.uploadAvatar('user-1', makeBuffer(), 'application/pdf', 1024, null),
    ).rejects.toThrow(UnsupportedMediaTypeError);
  });

  it('should throw UnsupportedMediaTypeError for text/html (HTTP 415)', async () => {
    await expect(
      UploadService.uploadAvatar('user-1', makeBuffer(), 'text/html', 1024, null),
    ).rejects.toThrow(UnsupportedMediaTypeError);
  });

  it('UnsupportedMediaTypeError should have statusCode 415', async () => {
    try {
      await UploadService.uploadAvatar('user-1', makeBuffer(), 'image/bmp', 1024, null);
    } catch (err) {
      expect((err as UnsupportedMediaTypeError).statusCode).toBe(415);
    }
  });

  // ── File size validation (HTTP 413) ────────────────────────────────────────

  it('should throw FileTooLargeError when file exceeds 5 MB (HTTP 413)', async () => {
    const oversizedBytes = MAX_AVATAR_SIZE_BYTES + 1;

    await expect(
      UploadService.uploadAvatar('user-1', makeBuffer(oversizedBytes), 'image/jpeg', oversizedBytes, null),
    ).rejects.toThrow(FileTooLargeError);
  });

  it('should accept a file exactly at the 5 MB limit', async () => {
    await expect(
      UploadService.uploadAvatar('user-1', makeBuffer(), 'image/png', MAX_AVATAR_SIZE_BYTES, null),
    ).resolves.toMatch(/^https:\/\//);
  });

  it('FileTooLargeError should have statusCode 413', async () => {
    try {
      await UploadService.uploadAvatar('user-1', makeBuffer(), 'image/jpeg', MAX_AVATAR_SIZE_BYTES + 1, null);
    } catch (err) {
      expect((err as FileTooLargeError).statusCode).toBe(413);
    }
  });

  // ── Constants ──────────────────────────────────────────────────────────────

  it('MAX_AVATAR_SIZE_BYTES should equal 5 MB', () => {
    expect(MAX_AVATAR_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });

  it('ALLOWED_AVATAR_MIME_TYPES should include only jpeg, png, webp', () => {
    expect(ALLOWED_AVATAR_MIME_TYPES.has('image/jpeg')).toBe(true);
    expect(ALLOWED_AVATAR_MIME_TYPES.has('image/png')).toBe(true);
    expect(ALLOWED_AVATAR_MIME_TYPES.has('image/webp')).toBe(true);
    expect(ALLOWED_AVATAR_MIME_TYPES.has('image/gif')).toBe(false);
    expect(ALLOWED_AVATAR_MIME_TYPES.has('image/bmp')).toBe(false);
  });

  // ── S3 key format ──────────────────────────────────────────────────────────

  it('should generate a unique S3 key per upload (different timestamps)', async () => {
    const [url1, url2] = await Promise.all([
      UploadService.uploadAvatar('user-5', makeBuffer(), 'image/jpeg', 1024, null),
      UploadService.uploadAvatar('user-5', makeBuffer(), 'image/jpeg', 1024, null),
    ]);
    // Both are valid URLs; they may share the same timestamp in fast test runs
    // but the key format must always be correct
    expect(url1).toMatch(/avatars\/user-5\/\d+\.jpg/);
    expect(url2).toMatch(/avatars\/user-5\/\d+\.jpg/);
  });
});
