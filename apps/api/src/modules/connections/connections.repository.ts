import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { Environment } from '../../database/enums/environment.enum';

type RestoreSafeMutation = ConnectionEntity | 'missing' | 'leased';

@Injectable()
export class ConnectionsRepository {
  constructor(
    @InjectRepository(ConnectionEntity)
    private readonly repository: Repository<ConnectionEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  private static readonly WITHOUT_PASSWORD = {
    id: true, name: true, slug: true, environment: true, dbType: true,
    host: true, port: true, database: true, username: true,
    isActive: true, createdAt: true, updatedAt: true,
  } as const;

  findAll(): Promise<ConnectionEntity[]> {
    return this.repository.find({
      where: { isActive: true },
      select: ConnectionsRepository.WITHOUT_PASSWORD,
    });
  }

  findById(id: string): Promise<ConnectionEntity | null> {
    return this.repository.findOne({ where: { id, isActive: true } });
  }

  findByIdSafe(id: string): Promise<ConnectionEntity | null> {
    return this.repository.findOne({
      where: { id, isActive: true },
      select: ConnectionsRepository.WITHOUT_PASSWORD,
    });
  }

  /** Active connection on the same physical target; host compared trimmed and case-insensitive. */
  findActiveByTarget(
    target: { dbType: DbTypeEnum; host: string; port: number; database: string },
    excludeId?: string,
  ): Promise<ConnectionEntity | null> {
    const query = this.repository
      .createQueryBuilder('c')
      .select(['c.id', 'c.name'])
      .where('c.isActive = true')
      .andWhere('c.dbType = :dbType', { dbType: target.dbType })
      .andWhere('lower(trim(c.host)) = lower(trim(:host))', { host: target.host })
      .andWhere('c.port = :port', { port: target.port })
      .andWhere('c.database = :database', { database: target.database });
    if (excludeId !== undefined) {
      query.andWhere('c.id <> :excludeId::uuid', { excludeId });
    }
    return query.getOne();
  }

  /** Active PROD connections of an engine, with the credentials to reach them. */
  findActiveProd(dbType: DbTypeEnum): Promise<ConnectionEntity[]> {
    return this.repository.find({
      where: { environment: Environment.PROD, dbType, isActive: true },
    });
  }

  /** Written outside `update()`: a PROD connection is immutable for the API, and this is not an edit by a user. */
  async saveServerFingerprint(id: string, serverFingerprint: string): Promise<void> {
    await this.repository.update({ id }, { serverFingerprint });
  }

  findBySlug(slug: string): Promise<ConnectionEntity | null> {
    return this.repository.findOne({ where: { slug, isActive: true } });
  }

  findByEnvironment(environment: Environment): Promise<ConnectionEntity[]> {
    return this.repository.find({
      where: { environment, isActive: true },
      select: ConnectionsRepository.WITHOUT_PASSWORD,
    });
  }

  findByIds(ids: string[]): Promise<ConnectionEntity[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.repository.find({
      where: { id: In(ids), isActive: true },
      select: ConnectionsRepository.WITHOUT_PASSWORD,
    });
  }

  // Returns slugs from ALL rows (including inactive/soft-deleted) so newly
  // generated slugs do not collide with retired connections.
  async findAllSlugs(): Promise<string[]> {
    const rows = await this.repository.find({ select: { slug: true } });
    return rows.map((r) => r.slug);
  }

  create(data: Partial<ConnectionEntity>): Promise<ConnectionEntity> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  update(
    id: string,
    data: Partial<ConnectionEntity>,
  ): Promise<RestoreSafeMutation> {
    return this.dataSource.transaction(async (manager) => {
      const connection = await this.lockAndCheckLease(manager, id);
      if (connection === 'missing' || connection === 'leased') return connection;
      // Keep the loaded entity instance: spreading it into a plain object would
      // make save() return a plain object, and the @Exclude() on `password`
      // (applied by ClassSerializerInterceptor) only works on class instances.
      // A field set to undefined means "not provided": assigning it would erase
      // the stored value on the entity that is saved and returned.
      const changes = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      );
      return manager.save(Object.assign(connection, changes));
    });
  }

  softDelete(id: string): Promise<RestoreSafeMutation> {
    return this.dataSource.transaction(async (manager) => {
      const connection = await this.lockAndCheckLease(manager, id);
      if (connection === 'missing' || connection === 'leased') return connection;
      return manager.save(ConnectionEntity, { ...connection, isActive: false });
    });
  }

  private async lockAndCheckLease(
    manager: EntityManager,
    id: string,
  ): Promise<RestoreSafeMutation> {
    const connection = await manager.findOne(ConnectionEntity, {
      where: { id, isActive: true },
      lock: { mode: 'pessimistic_write' },
    });
    if (!connection) return 'missing';

    const leases = await manager.query<{ targetConnectionId: string }[]>(
      `SELECT "targetConnectionId"
       FROM restore_leases
       WHERE "targetConnectionId" = $1::uuid
         AND "expiresAt" > CURRENT_TIMESTAMP`,
      [id],
    );

    return leases.length > 0 ? 'leased' : connection;
  }
}
