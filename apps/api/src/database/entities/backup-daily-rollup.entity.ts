import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Per-day aggregate of the `backup_jobs` rows that retention, reconcile or DB
 * hygiene deleted. `BackupRepository` writes it in the same SQL statement that
 * deletes the rows, and `JobsAnalyticsRepository` merges it with the live rows
 * so the daily analytics keep their history after a purge.
 *
 * `day` is the UTC calendar day of the deleted row's `createdAt` (a
 * `timestamp without time zone` column), exactly as the live query buckets it.
 * `durationsSeconds` holds the duration of every purged completed row that had
 * both timestamps: percentiles do not merge, so the raw values are kept.
 *
 * There is no foreign key: the rollup outlives soft-deleted connections.
 */
@Entity('backup_daily_rollups')
export class BackupDailyRollupEntity {
  @PrimaryColumn({
    type: 'varchar',
    primaryKeyConstraintName: 'PK_backup_daily_rollups',
  })
  connectionId!: string;

  /** UTC calendar day as `YYYY-MM-DD` (TypeORM maps `date` columns to strings). */
  @PrimaryColumn({
    type: 'date',
    primaryKeyConstraintName: 'PK_backup_daily_rollups',
  })
  day!: string;

  @Column({ type: 'integer', default: 0 })
  completed!: number;

  @Column({ type: 'integer', default: 0 })
  failed!: number;

  @Column({ type: 'double precision', default: 0 })
  totalSizeMb!: number;

  @Column({ type: 'double precision', array: true, default: () => `'{}'` })
  durationsSeconds!: number[];

  @UpdateDateColumn()
  updatedAt!: Date;
}
