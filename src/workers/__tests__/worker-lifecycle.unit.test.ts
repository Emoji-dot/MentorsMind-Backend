import { EventEmitter } from 'events';

const mockCaptureException = jest.fn();
const mockInc = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));
jest.mock('../../config/metrics', () => ({
  workerJobsFailedTotal: { inc: (...args: unknown[]) => mockInc(...args) },
}));
jest.mock('../../utils/logger.utils', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

import { registerWorkerLifecycleLogging } from '../lifecycle';

function makeWorker(): any {
  const worker: any = new EventEmitter();
  worker.name = 'email';
  worker.id = 'worker-1';
  worker.opts = { concurrency: 5 };
  return worker;
}

describe('registerWorkerLifecycleLogging — failed handler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('logs, reports to Sentry and increments the counter when a job fails', () => {
    const worker = registerWorkerLifecycleLogging(makeWorker());
    const err = new Error('SMTP down');
    const job = { id: 'job-42', name: 'send-welcome', attemptsMade: 3 };

    worker.emit('failed', job, err, 'active');

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: 'email',
        jobId: 'job-42',
        jobName: 'send-welcome',
        attemptsMade: 3,
        err,
      }),
      expect.stringContaining('SMTP down'),
    );
    expect(mockCaptureException).toHaveBeenCalledWith(err, {
      extra: { jobId: 'job-42', queueName: 'email', attemptsMade: 3 },
    });
    expect(mockInc).toHaveBeenCalledWith({ queue: 'email' });
  });

  it('does not throw when BullMQ emits failed with an undefined job', () => {
    const worker = registerWorkerLifecycleLogging(makeWorker());
    const err = new Error('connection lost');

    expect(() => worker.emit('failed', undefined, err, 'active')).not.toThrow();

    expect(mockCaptureException).toHaveBeenCalledWith(err, {
      extra: { jobId: undefined, queueName: 'email', attemptsMade: undefined },
    });
    expect(mockInc).toHaveBeenCalledWith({ queue: 'email' });
  });
});
