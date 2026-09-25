/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { of } from 'rxjs';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { SseService } from '../../shared/sse/sse.service';
import { AuthUser } from '../../auth/decorators/current-user.decorator';
import { JobStatus } from '../../database/enums/job-status.enum';
jest.mock('../../auth/auth.guard', () => ({
  BetterAuthGuard: class {},
}));

describe('BackupController', () => {
  let controller: BackupController;
  let mockBackupService: {
    createBackup: jest.Mock;
    triggerManual: jest.Mock;
    getBackupById: jest.Mock;
    getHistory: jest.Mock;
    listBackups: jest.Mock;
    getDownloadUrl: jest.Mock;
    listEnrichedDumps: jest.Mock;
    listDumpsFromR2: jest.Mock;
  };
  let mockSseService: {
    subscribe: jest.Mock;
  };

  const mockUser: AuthUser = {
    id: 'user-1',
    email: 'admin@vaultly.local',
    name: 'Admin',
    role: 'admin',
  };

  const mockReq = {} as Request;

  beforeEach(async () => {
    mockBackupService = {
      createBackup: jest.fn().mockResolvedValue({
        jobId: 'job-123',
        fileKey: 'prod-db/manual/test.dump',
        status: JobStatus.PENDING,
      }),
      triggerManual: jest.fn().mockResolvedValue({
        jobId: 'job-123',
        fileKey: 'prod-db/manual/test.dump',
        status: JobStatus.PENDING,
      }),
      getBackupById: jest.fn().mockResolvedValue({
        id: 'job-123',
        status: JobStatus.RUNNING,
      }),
      getHistory: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      listBackups: jest.fn().mockResolvedValue([]),
      getDownloadUrl: jest.fn().mockResolvedValue({ url: 'https://r2/test.dump', fileKey: 'test.dump' }),
      listEnrichedDumps: jest.fn().mockResolvedValue([]),
      listDumpsFromR2: jest.fn().mockResolvedValue([]),
    };

    mockSseService = {
      subscribe: jest.fn().mockReturnValue(of({ type: 'progress', payload: { percent: 50 } })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BackupController],
      providers: [
        { provide: BackupService, useValue: mockBackupService },
        { provide: SseService, useValue: mockSseService },
      ],
    }).compile();

    controller = module.get<BackupController>(BackupController);
  });

  it('createBackup returns 202 accepted admission payload', async () => {
    const result = await controller.createBackup({ connectionId: 'conn-1' }, mockUser, mockReq);

    expect(result).toEqual({
      jobId: 'job-123',
      fileKey: 'prod-db/manual/test.dump',
      status: JobStatus.PENDING,
    });
    expect(mockBackupService.createBackup).toHaveBeenCalledWith({ connectionId: 'conn-1' }, mockUser);
  });

  it('triggerManual returns admission payload', async () => {
    const result = await controller.triggerManual('conn-1', mockUser, mockReq);

    expect(result).toEqual({
      jobId: 'job-123',
      fileKey: 'prod-db/manual/test.dump',
      status: JobStatus.PENDING,
    });
    expect(mockBackupService.triggerManual).toHaveBeenCalledWith('conn-1', mockUser);
  });

  it('streamBackup subscribes to SSE events for given job id', async () => {
    const stream$ = await controller.streamBackup('job-123');
    expect(mockBackupService.getBackupById).toHaveBeenCalledWith('job-123');
    expect(mockSseService.subscribe).toHaveBeenCalledWith('job-123');

    const emitted: unknown[] = [];
    stream$.subscribe((event) => emitted.push(event));
    expect(emitted.length).toBe(1);
  });
});
