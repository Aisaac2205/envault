import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateRestoreLeases1778716800018 implements MigrationInterface {
  name = 'CreateRestoreLeases1778716800018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'restore_leases',
        columns: [
          { name: 'targetConnectionId', type: 'uuid', isPrimary: true },
          { name: 'restoreJobId', type: 'uuid', isUnique: true },
          { name: 'leaseToken', type: 'uuid' },
          { name: 'expiresAt', type: 'timestamptz' },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "restore_leases"');
  }
}
