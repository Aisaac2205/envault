import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { encrypt, decrypt } from '../../common/utils/encryption';
import { Environment } from '../enums/environment.enum';
import { DbTypeEnum } from '../enums/db-type.enum';

@Entity('connections')
export class ConnectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Index('IDX_connections_slug_unique', { unique: true })
  @Column({ type: 'varchar', length: 120 })
  slug!: string;

  @Column({ type: 'enum', enum: Environment })
  environment!: Environment;

  @Column({ type: 'enum', enum: DbTypeEnum, default: DbTypeEnum.POSTGRES })
  dbType!: DbTypeEnum;

  @Column()
  host!: string;

  @Column()
  port!: number;

  @Column()
  database!: string;

  @Column()
  username!: string;

  @Column({
    transformer: {
      to: (value: string) => encrypt(value),
      from: (value: string) => decrypt(value),
    },
  })
  @Exclude()
  password!: string;

  /**
   * Which database server this connection really reaches, as the server
   * reports it (see ServerFingerprintService). Read for PROD connections only,
   * so a restore can tell when another address points at the same database.
   */
  @Column({ type: 'varchar', nullable: true })
  @Exclude()
  serverFingerprint!: string | null;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
