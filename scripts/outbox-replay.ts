#!/usr/bin/env ts-node
/**
 * scripts/outbox-replay.ts — manual ops tool for the outbox DLQ.
 *
 * Examples:
 *   DATABASE_URL=... npx ts-node scripts/outbox-replay.ts list
 *   DATABASE_URL=... npx ts-node scripts/outbox-replay.ts list --limit 200
 *   DATABASE_URL=... npx ts-node scripts/outbox-replay.ts show <id>
 *   DATABASE_URL=... npx ts-node scripts/outbox-replay.ts replay <id>
 *   DATABASE_URL=... npx ts-node scripts/outbox-replay.ts replay-many \
 *     --aggregate-type dispute --since '24 hours ago'
 */

import { Pool } from "pg";
import { logger } from "../src/utils/logger.utils";
import {
  OutboxModel,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_RETENTION_DAYS,
} from "../src/models/outbox.model";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error("DATABASE_URL is required");
  process.exit(2);
}

function parseArgs(argv: string[]): {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const [, , command, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags };
}

async function cmdList(pool: Pool, limit: number): Promise<void> {
  const rows = await OutboxModel.listDeadLetter(Math.max(1, Math.min(200, limit)), pool);
  /* eslint-disable no-console */
  console.log(`dead-letter depth: ${rows.length} (showing up to ${limit})`);
  for (const r of rows) {
    console.log(
      [
        r.id,
        r.aggregate_type,
        r.aggregate_id,
        r.event_type,
        `attempts=${r.attempts}`,
        `last_error=${(r.last_error ?? "").slice(0, 64)}`,
        `created_at=${r.created_at.toISOString()}`,
      ].join(" | "),
    );
  }
  /* eslint-enable no-console */
}

async function cmdShow(pool: Pool, id: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT * FROM outbox_events WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (!rows[0]) {
    // eslint-disable-next-line no-console
    console.error(`No outbox row found for id=${id}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(rows[0], null, 2));
}

async function cmdReplay(pool: Pool, id: string): Promise<void> {
  const ok = await OutboxModel.replayDeadLetter(id, pool);
  if (!ok) {
    // eslint-disable-next-line no-console
    console.error(
      `No dead-letter row matching id=${id}. The row may already be pending.`,
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(
    `[OutboxReplay] Replayed outbox_id=${id} attempts reset, will be dispatched on next tick.`,
  );
  logger.info({ outboxId: id }, "outbox-replay: replayed");
}

async function cmdReplayMany(
  pool: Pool,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const conditions: string[] = [`status = 'dead_letter'`];
  const params: unknown[] = [];
  let idx = 1;
  if (flags["aggregate-type"]) {
    conditions.push(`aggregate_type = $${idx++}`);
    params.push(flags["aggregate-type"]);
  }
  if (flags["event-type"]) {
    conditions.push(`event_type = $${idx++}`);
    params.push(flags["event-type"]);
  }
  if (flags.since) {
    conditions.push(`created_at >= NOW() - ($${idx++} || ' seconds')::interval`);
    params.push(String(flags.since).replace(/\D/g, "") || "86400");
  }
  const where = conditions.join(" AND ");
  // Capture the row ids we are about to replay for logging.
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE outbox_events
     SET status = 'pending',
         attempts = 0,
         last_error = NULL,
         next_retry_at = NOW(),
         locked_until = NULL
     WHERE ${where}
     RETURNING id`,
    params,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[OutboxReplay] replay-many matched ${rows.length} row(s). First 5 ids:`,
    rows.slice(0, 5).map((r) => r.id).join(", "),
  );
  logger.info(
    { replayed: rows.length, sampleIds: rows.slice(0, 5).map((r) => r.id) },
    "outbox-replay: replay-many",
  );
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv);
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    switch (command) {
      case "list":
        await cmdList(
          pool,
          parseInt(String(flags.limit ?? "100"), 10) || 100,
        );
        break;
      case "show":
        if (!positional[0]) {
          throw new Error("Usage: show <outbox-id>");
        }
        await cmdShow(pool, positional[0]);
        break;
      case "replay":
        if (positional.length === 0) {
          throw new Error("Usage: replay <outbox-id>");
        }
        await cmdReplay(pool, positional[0]);
        break;
      case "replay-many":
        await cmdReplayMany(pool, flags);
        break;
      default:
        // eslint-disable-next-line no-console
        console.log(`OUTBOX_RETENTION_DAYS=${OUTBOX_RETENTION_DAYS} OUTBOX_MAX_ATTEMPTS=${OUTBOX_MAX_ATTEMPTS}`);
        // eslint-disable-next-line no-console
        console.log(`Unknown command: ${command ?? "(none)"}. Valid: list | show | replay | replay-many`);
        process.exit(2);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[OutboxReplay] error:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
