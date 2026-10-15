import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronjobEntity } from '../../database/entities/cronjob.entity';
import { JobStatus } from '../../database/enums/job-status.enum';

export interface RunMetadata {
  lastRunAt?: Date;
  lastStatus?: JobStatus;
  nextRunAt?: Date | null;
}

@Injectable()
export class CronjobsRepository {
  constructor(
    @InjectRepository(CronjobEntity)
    private readonly repository: Repository<CronjobEntity>,
  ) {}

  findAll(): Promise<CronjobEntity[]> {
    return this.repository.find({ order: { createdAt: 'DESC' } });
  }

  findAllActive(): Promise<CronjobEntity[]> {
    return this.repository.find({ where: { isActive: true } });
  }

  findById(id: string): Promise<CronjobEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  create(data: Partial<CronjobEntity>): Promise<CronjobEntity> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  // Merges into the stored row so that save() resolves with the whole cronjob.
  // Saving `{ id, ...data }` resolved with the request's fields only, and the
  // service, which reads `isActive` and `cronExpression` from the result,
  // unscheduled an active cronjob on every rename. Null when the row is gone.
  async update(id: string, data: Partial<CronjobEntity>): Promise<CronjobEntity | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    return this.repository.save(this.repository.merge(existing, data));
  }

  async updateRunMetadata(id: string, data: RunMetadata): Promise<void> {
    await this.repository.update(id, data);
  }

  async resetStaleRunning(): Promise<number> {
    const result = await this.repository.update(
      { lastStatus: JobStatus.RUNNING },
      { lastStatus: JobStatus.FAILED },
    );
    return result.affected ?? 0;
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  findByConnectionId(connectionId: string): Promise<CronjobEntity | null> {
    return this.repository.findOne({ where: { connectionId } });
  }

  async upsertForConnection(
    connectionId: string,
    data: Partial<CronjobEntity>,
  ): Promise<CronjobEntity> {
    const existing = await this.findByConnectionId(connectionId);
    if (existing) {
      return this.repository.save({ ...existing, ...data });
    }
    const entity = this.repository.create({ connectionId, ...data });
    return this.repository.save(entity);
  }
}
