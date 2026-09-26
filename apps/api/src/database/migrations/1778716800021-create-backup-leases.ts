import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateBackupLeases1778716800021 implements MigrationInterface {
  name = 'CreateBackupLeases1778716800021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'backup_leases',
        columns: [
          { name: 'connectionId', type: 'uuid', isPrimary: true },
          { name: 'backupJobId', type: 'uuid', isUnique: true },
          { name: 'leaseToken', type: 'uuid' },
          { name: 'expiresAt', type: 'timestamptz' },
          {
            name: 'acquiredAt',
            type: 'timestamptz',
            default: 'now()',
            isNullable: false,
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "backup_leases"');
  }
}
