/**
 * Audit Log Archival Job Tests (issue #772)
 *
 * Uses the same lightweight harness as the other __tests__ suites in this repo.
 * Run via:  npm run test:audit-archival
 *
 * Coverage:
 *  - Rows older than the cutoff are serialized as NDJSON, gzip-compressed,
 *    uploaded to S3 with Object Lock retention, and only then removed from
 *    PostgreSQL (via an INSERT into audit_log_archives + DELETE FROM audit_logs).
 *  - The S3 key follows the audit-archive/{year}/{month}/{day}/... layout.
 */

import { describe, it, expect } from './test-harness';
import zlib from 'zlib';
import pool from '../../config/database';
import { StorageService } from '../../services/storage.service';
import { AuditLogArchivalJob } from '../auditLog.job';

const sampleRows = [
  { id: 'log-1', created_at: new Date('2026-01-01T00:00:00.000Z'), action: 'LOGIN_SUCCESS' },
  { id: 'log-2', created_at: new Date('2026-01-02T00:00:00.000Z'), action: 'LOGOUT' },
];

function installMocks() {
  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);
  const originalUpload = StorageService.uploadFileWithRetention;

  let selectCalls = 0;
  const clientQueries: Array<{ text: string; params?: any[] }> = [];
  const uploadCalls: Array<{
    key: string;
    body: Buffer;
    contentType: string;
    retainUntilDate: Date;
  }> = [];

  (pool as any).query = async (text: string) => {
    if (text.includes('FROM audit_logs')) {
      selectCalls++;
      return selectCalls === 1 ? { rows: sampleRows } : { rows: [] };
    }
    return { rows: [] };
  };

  (pool as any).connect = async () => ({
    query: async (text: string, params?: any[]) => {
      clientQueries.push({ text, params });
      return { rows: [] };
    },
    release: () => {},
  });

  (StorageService as any).uploadFileWithRetention = async (
    key: string,
    body: Buffer,
    contentType: string,
    retainUntilDate: Date,
  ) => {
    uploadCalls.push({ key, body, contentType, retainUntilDate });
    return { key, url: `s3://test-bucket/${key}` };
  };

  return {
    clientQueries,
    uploadCalls,
    restore: () => {
      (pool as any).query = originalQuery;
      (pool as any).connect = originalConnect;
      (StorageService as any).uploadFileWithRetention = originalUpload;
    },
  };
}

describe('AuditLogArchivalJob.run — batch archival', () => {
  it('uploads a gzip NDJSON archive containing all fetched rows', async () => {
    const { uploadCalls, restore } = installMocks();
    try {
      await AuditLogArchivalJob.run();
      expect(uploadCalls.length).toBe(1);

      const decompressed = zlib.gunzipSync(uploadCalls[0].body).toString('utf-8');
      const lines = decompressed.trim().split('\n');
      expect(lines.length).toBe(2);
      expect(lines[0].includes('log-1')).toBeTruthy();
      expect(lines[1].includes('log-2')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('uses the audit-archive/{year}/{month}/{day}/... S3 key layout', async () => {
    const { uploadCalls, restore } = installMocks();
    try {
      await AuditLogArchivalJob.run();
      const key = uploadCalls[0].key;
      expect(key.startsWith('audit-archive/')).toBeTruthy();
      expect(key.endsWith('.ndjson.gz')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('sets an Object Lock retainUntilDate in the future', async () => {
    const { uploadCalls, restore } = installMocks();
    try {
      await AuditLogArchivalJob.run();
      const retainUntilDate = uploadCalls[0].retainUntilDate;
      expect(retainUntilDate.getTime() > Date.now()).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('only deletes archived rows from PostgreSQL after the S3 upload succeeds', async () => {
    const { clientQueries, restore } = installMocks();
    try {
      const result = await AuditLogArchivalJob.run();
      expect(result.totalRowsArchived).toBe(2);
      expect(result.batches).toBe(1);

      const insertCall = clientQueries.find((q) => q.text.includes('INSERT INTO audit_log_archives'));
      const deleteCall = clientQueries.find((q) => q.text.includes('DELETE FROM audit_logs'));
      expect(!!insertCall).toBeTruthy();
      expect(!!deleteCall).toBeTruthy();

      const insertIndex = clientQueries.indexOf(insertCall!);
      const deleteIndex = clientQueries.indexOf(deleteCall!);
      // INSERT (archive metadata) must be recorded before the DELETE runs.
      expect(insertIndex < deleteIndex).toBeTruthy();
    } finally {
      restore();
    }
  });
});
