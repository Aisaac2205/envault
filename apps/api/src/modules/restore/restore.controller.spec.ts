/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { RestoreController } from './restore.controller';
import { RestoreService } from './restore.service';
import { ConnectionsService } from '../connections/connections.service';
import { AuthUser } from '../../auth/decorators/current-user.decorator';
import { JobStatus } from '../../database/enums/job-status.enum';
import { Environment } from '../../database/enums/environment.enum';

jest.mock('../../auth/auth.guard', () => ({
  BetterAuthGuard: class {},
}));

describe('RestoreController', () => {
  let controller: RestoreController;
  let mockRestoreService: {
    createRestore: jest.Mock;
    cancelRestore: jest.Mock;
    listRestores: jest.Mock;
    getRestoreById: jest.Mock;
  };
  let mockConnectionsService: {
    findById: jest.Mock;
  };

  const mockUser: AuthUser = {
    id: 'user-1',
    email: 'admin@envault.dev',
    name: 'Admin',
    role: 'admin',
  };

  const mockReq = {} as Request;

  beforeEach(async () => {
    mockRestoreService = {
      createRestore: jest.fn().mockResolvedValue({
        jobId: 'restore-123',
      }),
      cancelRestore: jest.fn().mockResolvedValue({
        message: 'Restauración cancelada exitosamente',
        jobId: 'restore-123',
        status: JobStatus.FAILED,
      }),
      listRestores: jest.fn().mockResolvedValue([]),
      getRestoreById: jest.fn().mockResolvedValue({
        id: 'restore-123',
        status: JobStatus.COMPLETED,
      }),
    };

    mockConnectionsService = {
      findById: jest.fn().mockResolvedValue({
        id: 'conn-1',
        environment: Environment.DEV,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RestoreController],
      providers: [
        { provide: RestoreService, useValue: mockRestoreService },
        { provide: ConnectionsService, useValue: mockConnectionsService },
      ],
    }).compile();

    controller = module.get<RestoreController>(RestoreController);
  });

  it('createRestore returns admission payload with jobId', async () => {
    const dto = {
      targetConnectionId: 'conn-1',
      sourceBackupId: 'backup-1',
      isDryRun: false,
    };

    const result = await controller.createRestore(dto, mockUser, mockReq);

    expect(result).toEqual({ jobId: 'restore-123' });
    expect(mockRestoreService.createRestore).toHaveBeenCalledWith(dto, mockUser);
    expect(mockConnectionsService.findById).toHaveBeenCalledWith('conn-1');
  });

  it('cancelRestore delegates to restoreService and returns cancellation payload', async () => {
    const result = await controller.cancelRestore('restore-123', mockUser, mockReq);

    expect(result).toEqual({
      message: 'Restauración cancelada exitosamente',
      jobId: 'restore-123',
      status: JobStatus.FAILED,
    });
    expect(mockRestoreService.cancelRestore).toHaveBeenCalledWith('restore-123', mockUser);
  });

  it('listRestores returns restore job list from service', async () => {
    const result = await controller.listRestores();
    expect(result).toEqual([]);
    expect(mockRestoreService.listRestores).toHaveBeenCalled();
  });

  it('getRestoreById returns requested restore job from service', async () => {
    const result = await controller.getRestoreById('restore-123');
    expect(result).toEqual({
      id: 'restore-123',
      status: JobStatus.COMPLETED,
    });
    expect(mockRestoreService.getRestoreById).toHaveBeenCalledWith('restore-123');
  });
});
