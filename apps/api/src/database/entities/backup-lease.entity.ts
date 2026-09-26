import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('backup_leases')
export class BackupLeaseEntity {
  @PrimaryColumn({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'uuid', unique: true })
  backupJobId!: string;

  @Column({ type: 'uuid' })
  leaseToken!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz' })
  acquiredAt!: Date;
}
