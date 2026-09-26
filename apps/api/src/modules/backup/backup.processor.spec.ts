/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { BackupProcessor } from './backup.processor';
import { BackupService } from './backup.service';
import { DelayedError, Job } from 'bullmq';
import { ProcessBackupJobData } from './backup.processor';

describe('BackupProcessor', () => {
  let processor: BackupProcessor;
  let mockBackupService: {
    executeQueuedBackup: jest.Mock;
  };

  beforeEach(async () => {
    mockBackupService = {
      executeQueuedBackup: jest.fn().mockResolvedValue({
        kind: 'finished',
        result: { jobId: 'job-123', status: 'completed' },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupProcessor,
        { provide: BackupService, useValue: mockBackupService },
      ],
    }).compile();

    processor = module.get<BackupProcessor>(BackupProcessor);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeJob(overrides: {
    jobId?: string;
    attemptsMade?: number;
    attemptsStarted?: number;
  } = {}): Job<ProcessBackupJobData> {
    return {
      data: { jobId: overrides.jobId ?? 'job-123' },
      attemptsMade: overrides.attemptsMade ?? 0,
      attemptsStarted: overrides.attemptsStarted ?? 1,
      moveToDelayed: jest.fn().mockResolvedValue(undefined),
    } as unknown as Job<ProcessBackupJobData>;
  }

  it('delegates execution of a first-attempt queued backup job to BackupService', async () => {
    const mockJob = makeJob({ attemptsMade: 0 });

    await processor.process(mockJob, 'token-1');

    expect(mockBackupService.executeQueuedBackup).toHaveBeenCalledWith('job-123', {
      isRetry: false,
    });
    expect(mockJob.moveToDelayed).not.toHaveBeenCalled();
  });

  it('marks isRetry=true once a previous attempt has genuinely failed', async () => {
    const mockJob = makeJob({ attemptsMade: 1, attemptsStarted: 2 });

    await processor.process(mockJob, 'token-1');

    expect(mockBackupService.executeQueuedBackup).toHaveBeenCalledWith('job-123', {
      isRetry: true,
    });
  });

  it('defers the job via moveToDelayed and throws DelayedError when the connection is busy', async () => {
    mockBackupService.executeQueuedBackup.mockResolvedValue({ kind: 'deferred' });
    const mockJob = makeJob();
    const before = Date.now();

    await expect(processor.process(mockJob, 'token-1')).rejects.toBeInstanceOf(DelayedError);

    expect(mockJob.moveToDelayed).toHaveBeenCalledTimes(1);
    const [timestamp, token] = (mockJob.moveToDelayed as jest.Mock).mock.calls[0];
    expect(token).toBe('token-1');
    expect(timestamp).toBeGreaterThan(before);
  });

  it('does not throw or move a finished job', async () => {
    const mockJob = makeJob();

    await expect(processor.process(mockJob, 'token-1')).resolves.toBeUndefined();
    expect(mockJob.moveToDelayed).not.toHaveBeenCalled();
  });

  it('does not throw or move a skipped job (terminal-status guard)', async () => {
    mockBackupService.executeQueuedBackup.mockResolvedValue({
      kind: 'skipped',
      status: 'failed',
    });
    const mockJob = makeJob();

    await expect(processor.process(mockJob, 'token-1')).resolves.toBeUndefined();
    expect(mockJob.moveToDelayed).not.toHaveBeenCalled();
  });

  describe('busy backoff', () => {
    it('computes exponential backoff capped at 300s with jitter between 0.8x and 1.2x', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5); // jitter = 1.0 exactly
      mockBackupService.executeQueuedBackup.mockResolvedValue({ kind: 'deferred' });

      const cases: Array<{ attemptsStarted: number; attemptsMade: number; expectedMs: number }> = [
        { attemptsStarted: 1, attemptsMade: 0, expectedMs: 30_000 },
        { attemptsStarted: 2, attemptsMade: 0, expectedMs: 60_000 },
        { attemptsStarted: 3, attemptsMade: 0, expectedMs: 120_000 },
        { attemptsStarted: 20, attemptsMade: 0, expectedMs: 300_000 },
      ];

      for (const { attemptsStarted, attemptsMade, expectedMs } of cases) {
        const before = Date.now();
        const mockJob = makeJob({ attemptsStarted, attemptsMade });

        await expect(processor.process(mockJob, 'token-1')).rejects.toBeInstanceOf(DelayedError);

        const [timestamp] = (mockJob.moveToDelayed as jest.Mock).mock.calls[0];
        const delayMs = timestamp - before;
        expect(delayMs).toBeGreaterThanOrEqual(expectedMs - 50);
        expect(delayMs).toBeLessThanOrEqual(expectedMs + 1000);
      }
    });

    it('applies jitter within the 0.8x-1.2x bounds', async () => {
      mockBackupService.executeQueuedBackup.mockResolvedValue({ kind: 'deferred' });
      const before = Date.now();
      const mockJob = makeJob({ attemptsStarted: 1, attemptsMade: 0 });

      await expect(processor.process(mockJob, 'token-1')).rejects.toBeInstanceOf(DelayedError);

      const [timestamp] = (mockJob.moveToDelayed as jest.Mock).mock.calls[0];
      const delayMs = timestamp - before;
      expect(delayMs).toBeGreaterThanOrEqual(30_000 * 0.8 - 50);
      expect(delayMs).toBeLessThanOrEqual(30_000 * 1.2 + 1000);
    });
  });
});
