import { run } from './test-harness';
import './auditLog.archival.test';

// The pg Pool created by config/database.ts keeps a connection alive; force
// exit once the suite finishes so this script doesn't hang.
run().then(() => process.exit(process.exitCode ?? 0));
