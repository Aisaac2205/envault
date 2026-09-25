import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Interval, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { CronjobsRepository } from './cronjobs.repository';
import { BackupService } from '../backup/backup.service';
import { MaintenanceService } from '../maintenance/maintenance.service';
import { RetentionPolicy } from '../maintenance/interfaces/retention.interface';
import { ConnectionsService } from '../connections/connections.service';
import { CreateCronjobDto } from './dto/create-cronjob.dto';
import { UpdateCronjobDto } from './dto/update-cronjob.dto';
import { CronjobEntity } from '../../database/entities/cronjob.entity';
import { AuthUser } from '../../auth/decorators/current-user.decorator';
import { JobStatus } from '../../database/enums/job-status.enum';
import { CronFrequency } from '../../database/enums/cron-frequency.enum';
import { BackupCategory } from '../../database/enums/backup-category.enum';

const FREQUENCY_TO_CATEGORY: Record<CronFrequency, BackupCategory> = {
  [CronFrequency.HOURLY]: BackupCategory.HOURLY,
  [CronFrequency.DAILY]: BackupCategory.DAILY,
  [CronFrequency.WEEKLY]: BackupCategory.WEEKLY,
  [CronFrequency.CUSTOM]: BackupCategory.CUSTOM,
};

// CUSTOM is intentionally omitted: we can't infer a period from a free-form
// cron expression without parsing it, and cron.lastDate() is unreliable on a
// freshly-instantiated job (returns the instance's last fire, not the last
// tick the expression should have produced).
const FREQUENCY_TO_PERIOD_MS: Partial<Record<CronFrequency, number>> = {
  [CronFrequency.HOURLY]: 60 * 60 * 1000,
  [CronFrequency.DAILY]: 24 * 60 * 60 * 1000,
  [CronFrequency.WEEKLY]: 7 * 24 * 60 * 60 * 1000,
};

const MISSED_TICK_TOLERANCE = 1.5;

const SYSTEM_USER: AuthUser = {
  id: 'system-cronjob',
  email: 'system@vaultly.local',
  name: 'System',
  role: 'admin',
};

@Injectable()
export class CronjobsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CronjobsService.name);

  constructor(
    private readonly repository: CronjobsRepository,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly backupService: BackupService,
    private readonly maintenanceService: MaintenanceService,
    private readonly connectionsService: ConnectionsService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private async enrichWithConnectionName(
    cronjob: CronjobEntity,
  ): Promise<CronjobEntity & { connectionName: string | null }> {
    const nameMap = await this.connectionsService.findByIds([cronjob.connectionId]);
    return Object.assign(cronjob, {
      connectionName: nameMap.get(cronjob.connectionId) ?? null,
    });
  }

  private async enrichManyWithConnectionName(
    cronjobs: CronjobEntity[],
  ): Promise<(CronjobEntity & { connectionName: string | null })[]> {
    if (cronjobs.length === 0) return [];
    const ids = [...new Set(cronjobs.map((c) => c.connectionId))];
    const nameMap = await this.connectionsService.findByIds(ids);
    return cronjobs.map((c) =>
      Object.assign(c, { connectionName: nameMap.get(c.connectionId) ?? null }),
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      // CJ-2: Reset stale RUNNING jobs from previous crashes
      await this.repository.resetStaleRunning();

      const active = await this.repository.findAllActive();
      for (const cronjob of active) {
        this.registerCronJob(cronjob);
        // Per-iteration catch: if the UPDATE fails we keep the job registered
        // and let the next execution refresh nextRunAt. Without this, a single
        // DB blip would skip registration for all remaining cronjobs.
        await this.syncNextRunAt(cronjob).catch((err) => {
          this.logger.warn(
            `syncNextRunAt failed for "${cronjob.name}": ${err instanceof Error ? err.message : String(err)}`,
          );
        });
        this.catchUpIfMissed(cronjob);
      }
      this.logger.log(`Registered ${active.length} active cronjobs`);
    } catch (error) {
      const message =
        error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
      this.logger.error(`onApplicationBootstrap failed: ${message}`);
    }
  }

  async findAll() {
    const cronjobs = await this.repository.findAll();
    return this.enrichManyWithConnectionName(cronjobs);
  }

  async findById(id: string) {
    const cronjob = await this.repository.findById(id);
    if (!cronjob) {
      throw new NotFoundException(`Cronjob con ID "${id}" no encontrado`);
    }
    return this.enrichWithConnectionName(cronjob);
  }

  async create(dto: CreateCronjobDto) {
    this.validateCronExpression(dto.cronExpression);
    const cronjob = await this.repository.create(dto);
    if (cronjob.isActive) {
      this.registerCronJob(cronjob);
    }
    await this.syncNextRunAt(cronjob);
    return this.enrichWithConnectionName(cronjob);
  }

  async update(id: string, dto: UpdateCronjobDto) {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Cronjob con ID "${id}" no encontrado`);
    }
    if (dto.cronExpression !== undefined) {
      this.validateCronExpression(dto.cronExpression);
    }
    const updated = await this.repository.update(id, dto);
    this.unregisterCronJob(id);
    if (updated.isActive) {
      this.registerCronJob(updated);
    }
    await this.syncNextRunAt(updated);
    return this.enrichWithConnectionName(updated);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Cronjob con ID "${id}" no encontrado`);
    }
    this.unregisterCronJob(id);
    await this.repository.delete(id);
  }

  async toggle(id: string) {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Cronjob con ID "${id}" no encontrado`);
    }
    const updated = await this.repository.update(id, { isActive: !existing.isActive });
    if (updated.isActive) {
      this.registerCronJob(updated);
    } else {
      this.unregisterCronJob(id);
    }
    await this.syncNextRunAt(updated);
    return this.enrichWithConnectionName(updated);
  }

  async upsertSchedule(
    connectionId: string,
    cronExpression: string,
    name: string,
    frequency: CronFrequency,
  ): Promise<CronjobEntity> {
    this.validateCronExpression(cronExpression);
    const entity = await this.repository.upsertForConnection(connectionId, {
      name,
      cronExpression,
      frequency,
      isActive: true,
    });
    this.unregisterCronJob(entity.id);
    this.registerCronJob(entity);
    await this.syncNextRunAt(entity);
    return entity;
  }

  // Keeps DB nextRunAt in sync with the live scheduler so the UI can show the
  // upcoming tick immediately (before the first execution writes it). When the
  // job is inactive there's no scheduler entry, so we null it out.
  private async syncNextRunAt(cronjob: CronjobEntity): Promise<void> {
    const nextRunAt = cronjob.isActive ? this.getNextRunDate(cronjob.id) : null;
    await this.repository.updateRunMetadata(cronjob.id, { nextRunAt });
    cronjob.nextRunAt = nextRunAt;
  }

  private validateCronExpression(expression: string): void {
    try {
      new CronJob(expression, () => undefined);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(
        `Expresión cron inválida: "${expression}". ${detail}`,
      );
    }
  }

  private registerCronJob(cronjob: CronjobEntity): void {
    try {
      const job = new CronJob(cronjob.cronExpression, () => {
        this.executeCronjob(cronjob.id).catch((err) => {
          this.logger.error(
            `Unhandled error in cronjob "${cronjob.name}": ${
              err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
            }`,
          );
        });
      });
      this.schedulerRegistry.addCronJob(cronjob.id, job);
      job.start();
      this.logger.log(`Registered cronjob "${cronjob.name}" [${cronjob.cronExpression}]`);
    } catch (error) {
      this.logger.error(
        `Failed to register cronjob "${cronjob.name}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Why frequency-based (not cron.lastDate()): in cron v3/v4, lastDate()
  // returns the last fire of THIS instance — for a job just created at boot
  // it's null and catch-up never triggers. Reference is lastRunAt ?? createdAt
  // to avoid spurious fires on freshly-created jobs (e.g. a DAILY @ 2am
  // created at noon would fire on the next restart if we used only lastRunAt).
  // The 1.5x tolerance absorbs scheduler jitter without missing real gaps.
  private catchUpIfMissed(cronjob: CronjobEntity): void {
    const period = FREQUENCY_TO_PERIOD_MS[cronjob.frequency];
    if (!period) return;

    // CJ-3: Skip catch-up if the job is already running
    if (cronjob.lastStatus === JobStatus.RUNNING) return;

    const reference = cronjob.lastRunAt ?? cronjob.createdAt;
    const elapsed = Date.now() - reference.getTime();

    if (elapsed > period * MISSED_TICK_TOLERANCE) {
      this.logger.warn(
        `Cronjob "${cronjob.name}" missed a tick (elapsed ${Math.round(elapsed / 1000)}s, period ${period / 1000}s). Catching up.`,
      );
      this.executeCronjob(cronjob.id).catch((err) => {
        this.logger.error(
          `Catch-up failed for cronjob "${cronjob.name}": ${
            err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
          }`,
        );
      });
    }
  }

  @Interval(300_000)
  async handleWatchdog(): Promise<number> {
    return this.checkWatchdog();
  }


  async checkWatchdog(): Promise<number> {
    const active = await this.repository.findAllActive();
    let overdueCount = 0;
    const now = Date.now();

    for (const cronjob of active) {
      if (cronjob.lastStatus === JobStatus.RUNNING) continue;

      const period = FREQUENCY_TO_PERIOD_MS[cronjob.frequency];
      if (period) {
        const reference = cronjob.lastRunAt ?? cronjob.createdAt;
        const elapsed = now - reference.getTime();
        if (elapsed > period * MISSED_TICK_TOLERANCE) {
          overdueCount++;
          this.logger.error(
            `[WATCHDOG ALERT] Cronjob "${cronjob.name}" (${cronjob.id}) está vencido: han transcurrido ${Math.round(elapsed / 1000)}s para un período de ${period / 1000}s.`,
          );
          this.catchUpIfMissed(cronjob);
          continue;
        }
      }

      if (cronjob.nextRunAt && now > cronjob.nextRunAt.getTime() + 5 * 60_000) {
        overdueCount++;
        this.logger.error(
          `[WATCHDOG ALERT] Cronjob "${cronjob.name}" (${cronjob.id}) superó su tiempo de ejecución programado (${cronjob.nextRunAt.toISOString()}).`,
        );
      }
    }

    return overdueCount;
  }


  private unregisterCronJob(id: string): void {
    try {
      this.schedulerRegistry.deleteCronJob(id);
    } catch {
      // Normal if the cronjob was inactive and never registered
    }
  }

  // Defensive try/catch wraps the ENTIRE method, including the first findById
  // and the RUNNING-status write. In Node 22, an unhandledRejection here is
  // fatal — the process dies, the platform restarts, and the tick is lost
  // silently. This method must NEVER propagate.
  private async executeCronjob(cronjobId: string): Promise<void> {
    const startedAt = new Date();
    let cronjobName = cronjobId;

    try {
      const lockId = this.stableHash(cronjobId);
      const queryRunner = this.dataSource.createQueryRunner();
      try {
        await queryRunner.connect();
        const lockResult = await this.dataSource.query<Array<{ acquired: boolean }>>(
          'SELECT pg_try_advisory_lock($1) AS acquired',
          [lockId],
          queryRunner,
        );
        if (!lockResult[0]?.acquired) {
          this.logger.debug(`Cronjob "${cronjobId}" skipped — lock held by another replica`);
          return;
        }

        try {
          const cronjob = await this.repository.findById(cronjobId);
          if (!cronjob?.isActive) return;
          cronjobName = cronjob.name;

          if (cronjob.lastStatus === JobStatus.RUNNING) {
            this.logger.debug(`Cronjob "${cronjob.name}" skipped — already RUNNING`);
            return;
          }

          this.logger.log(
            `Executing cronjob "${cronjob.name}" → connection ${cronjob.connectionId}`,
          );

          await this.repository.updateRunMetadata(cronjobId, {
            lastRunAt: startedAt,
            lastStatus: JobStatus.RUNNING,
          });

          try {
            await this.backupService.createBackup(
              { connectionId: cronjob.connectionId },
              SYSTEM_USER,
              FREQUENCY_TO_CATEGORY[cronjob.frequency],
            );

            await this.repository.updateRunMetadata(cronjobId, {
              lastRunAt: startedAt,
              lastStatus: JobStatus.COMPLETED,
              nextRunAt: this.getNextRunDate(cronjobId),
            });

            this.logger.log(`Cronjob "${cronjob.name}" completed`);

            await this.applyRetention(cronjob);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Error desconocido';
            this.logger.error(`Cronjob "${cronjob.name}" failed: ${message}`);

            await this.repository
              .updateRunMetadata(cronjobId, {
                lastRunAt: startedAt,
                lastStatus: JobStatus.FAILED,
              })
              .catch((updateErr) => {
                this.logger.error(
                  `Failed to persist FAILED status for "${cronjob.name}": ${
                    updateErr instanceof Error ? updateErr.message : String(updateErr)
                  }`,
                );
              });
          }
        } finally {
          try {
            const unlockResult = await this.dataSource.query<Array<{ released: boolean }>>(
              'SELECT pg_advisory_unlock($1) AS released',
              [lockId],
              queryRunner,
            );
            if (!unlockResult[0]?.released) {
              this.logger.error(`Cronjob "${cronjobId}" advisory lock release failed`);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Cronjob "${cronjobId}" advisory lock release failed: ${message}`,
            );
          }
        }
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      const message =
        error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
      this.logger.error(
        `executeCronjob("${cronjobName}") crashed before status tracking: ${message}`,
      );
    }
  }

  // Prune old dumps for this cronjob's connection+category per the
  // connection-specific retention policy stored in connection_retention_policies.
  // Self-contained try/catch: a retention failure must never propagate and turn
  // a successful backup into a FAILED run.
  private async applyRetention(cronjob: CronjobEntity): Promise<void> {
    try {
      const connection = await this.connectionsService.findById(cronjob.connectionId);
      const category = FREQUENCY_TO_CATEGORY[cronjob.frequency];
      const retentionPolicy = await this.maintenanceService.getRetentionPolicy(
        connection.slug,
        category,
      );

      if (!retentionPolicy || retentionPolicy.retentionDays == null) return;

      const policy: RetentionPolicy = {
        maxAgeDays: retentionPolicy.retentionDays,
      };

      const result = await this.maintenanceService.applyRetention(
        connection.slug,
        category,
        policy,
      );
      if (result.deleted > 0 || result.errors.length > 0) {
        this.logger.log(
          `Retention "${cronjob.name}": pruned ${result.deleted} (${result.freedMb} MB), ${result.errors.length} error(s)`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Retention failed for "${cronjob.name}": ${message}`);
    }
  }

  private stableHash(uuid: string): number {
    // Convert UUID to a stable 32-bit integer for pg_advisory_lock
    let hash = 0;
    for (let i = 0; i < uuid.length; i++) {
      hash = ((hash << 5) - hash + uuid.charCodeAt(i)) | 0;
    }
    return hash;
  }

  private getNextRunDate(cronjobId: string): Date | null {
    try {
      const job = this.schedulerRegistry.getCronJob(cronjobId);
      const next = job.nextDate();
      return typeof (next as unknown as { toJSDate?: () => Date }).toJSDate === 'function'
        ? (next as unknown as { toJSDate: () => Date }).toJSDate()
        : null;
    } catch {
      return null;
    }
  }
}
