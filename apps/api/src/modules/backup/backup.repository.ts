import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  In,
  LessThan,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { BackupJobEntity } from '../../database/entities/backup-job.entity';
import { JobStatus } from '../../database/enums/job-status.enum';
import { Environment } from '../../database/enums/environment.enum';

@Injectable()
export class BackupRepository {
  constructor(
    @InjectRepository(BackupJobEntity)
    private readonly repository: Repository<BackupJobEntity>,
  ) {}

  /**
   * When pagination options are provided, uses findAndCount with skip/take.
   * When omitted, returns all rows (backward compatibility for non-list endpoints).
   */
  async findAll(options?: {
    page?: number;
    pageSize?: number;
    connectionId?: string;
    environment?: Environment;
    status?: JobStatus;
    from?: string;
    to?: string;
  }): Promise<{ data: BackupJobEntity[]; total: number }> {
    const where: FindOptionsWhere<BackupJobEntity> = {};
    if (options?.connectionId) {
      where.connectionId = options.connectionId;
    }
    if (options?.environment) {
      where.environment = options.environment;
    }
    if (options?.status) {
      where.status = options.status;
    }
    if (options?.from || options?.to) {
      if (options.from && options.to) {
        where.createdAt = Between(new Date(options.from), new Date(options.to));
      } else if (options.from) {
        where.createdAt = MoreThanOrEqual(new Date(options.from));
      } else if (options.to) {
        where.createdAt = LessThanOrEqual(new Date(options.to));
      }
    }

    if (options?.page && options?.pageSize) {
      const [data, total] = await this.repository.findAndCount({
        where,
        order: { createdAt: 'DESC' },
        take: options.pageSize,
        skip: (options.page - 1) * options.pageSize,
      });
      return { data, total };
    }
    const data = await this.repository.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return { data, total: data.length };
  }

  findById(id: string): Promise<BackupJobEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  findByConnection(connectionId: string): Promise<BackupJobEntity[]> {
    return this.repository.find({
      where: { connectionId },
      order: { createdAt: 'DESC' },
    });
  }

  findActiveJobForConnection(connectionId: string): Promise<BackupJobEntity | null> {
    return this.repository.findOne({
      where: {
        connectionId,
        status: In([JobStatus.PENDING, JobStatus.RUNNING]),
      },
      order: { createdAt: 'DESC' },
    });
  }

  create(data: Partial<BackupJobEntity>): Promise<BackupJobEntity> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async updateStatus(
    id: string,
    status: JobStatus,
    updates?: Partial<BackupJobEntity>,
  ): Promise<void> {
    await this.repository.update(id, { status, ...updates });
  }

  /** Deletes job rows whose fileKey is in the given list. Returns rows removed. */
  async deleteByFileKeys(fileKeys: string[]): Promise<number> {
    if (fileKeys.length === 0) return 0;
    const result = await this.repository.delete({ fileKey: In(fileKeys) });
    return result.affected ?? 0;
  }

  /** Deletes job rows by id. Returns rows removed. */
  async deleteByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.repository.delete({ id: In(ids) });
    return result.affected ?? 0;
  }

  /** Count of FAILED jobs created before the cutoff (DB-hygiene preview). */
  countFailedOlderThan(cutoff: Date): Promise<number> {
    return this.repository.count({
      where: { status: JobStatus.FAILED, createdAt: LessThan(cutoff) },
    });
  }

  /** Removes FAILED jobs created before the cutoff. Returns rows removed. */
  async deleteFailedOlderThan(cutoff: Date): Promise<number> {
    const result = await this.repository.delete({
      status: JobStatus.FAILED,
      createdAt: LessThan(cutoff),
    });
    return result.affected ?? 0;
  }
}
