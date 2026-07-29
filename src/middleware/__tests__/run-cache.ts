import { run } from './cors-test-harness';
import './cache.middleware.test';

// cache.service.ts starts an un-refed-unsafe setInterval for in-memory
// eviction, which would otherwise keep this script running forever.
run().then(() => process.exit(process.exitCode ?? 0));
