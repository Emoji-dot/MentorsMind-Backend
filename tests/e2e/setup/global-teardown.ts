/**
 * global-teardown.ts
 *
 * Jest globalTeardown — runs ONCE after all test suites in the E2E run.
 * Stops the PostgreSQL and Redis testcontainers and removes the state file.
 */

import * as fs from 'fs';
import * as path from 'path';

const CONTAINER_STATE_FILE = path.join(__dirname, '.container-state.json');

export default async function globalTeardown(): Promise<void> {
  console.log('\n🛑  [E2E] Stopping testcontainers...');

  // Retrieve containers stashed by global-setup in the same process
  const containers = (global as any).__E2E_CONTAINERS__;

  if (containers) {
    try {
      await Promise.all([
        containers.postgres?.stop({ timeout: 10_000 }),
        containers.redis?.stop({ timeout: 10_000 }),
      ]);
      console.log('✅  [E2E] Containers stopped.');
    } catch (err) {
      console.warn('⚠️   [E2E] Container teardown error (non-fatal):', err);
    }
  } else {
    console.warn('⚠️   [E2E] No container references found in global — skipping stop.');
  }

  // Clean up temp state file
  if (fs.existsSync(CONTAINER_STATE_FILE)) {
    fs.unlinkSync(CONTAINER_STATE_FILE);
  }

  console.log('🏁  [E2E] Global teardown complete.\n');
}
