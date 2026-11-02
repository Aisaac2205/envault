import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Client } from 'pg';
import { createConnection as createMysqlConnection, RowDataPacket } from 'mysql2/promise';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { sanitizeMessage } from '../../common/sanitization/sanitize-message';
import { ConnectionsRepository } from './connections.repository';

const FINGERPRINT_TIMEOUT_MS = 5000;

export interface ServerEndpoint {
  dbType: DbTypeEnum;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

/**
 * The environment label and the address of a connection are both typed by a
 * person. The server tells the truth: another host name, a pooler or a proxy
 * can reach the same PROD database under a QA label, but not under another
 * server identifier. The fingerprint is the server's identity plus the database
 * name it reports, so a different database on the same server stays allowed.
 */
@Injectable()
export class ServerFingerprintService {
  private readonly logger = new Logger(ServerFingerprintService.name);

  constructor(private readonly repository: ConnectionsRepository) {}

  /** `<dbType>:<server id>/<database>`, or null when the server cannot be asked. */
  async read(endpoint: ServerEndpoint): Promise<string | null> {
    try {
      return endpoint.dbType === DbTypeEnum.MYSQL
        ? await this.readMysql(endpoint)
        : await this.readPostgres(endpoint);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Server fingerprint not available: ${sanitizeMessage(message)}`);
      return null;
    }
  }

  /**
   * Refuses a target that is a PROD database, whatever its label or address.
   * With a PROD fingerprint to compare against, a target that cannot be
   * identified is refused too: not knowing is not a reason to go ahead.
   */
  async assertNotProduction(target: ConnectionEntity): Promise<void> {
    const prods = await this.fingerprintedProds(target.dbType);
    if (prods.length === 0) return;

    const fingerprint = await this.read(target);
    if (fingerprint === null) {
      throw new ForbiddenException(
        'No se pudo verificar la identidad del servidor destino, y hay conexiones de producción registradas. Se rechaza la restauración.',
      );
    }
    const clash = prods.find((prod) => prod.serverFingerprint === fingerprint);
    if (clash) {
      throw new ForbiddenException(
        `El destino es la misma base de datos que la conexión de producción "${clash.name}".`,
      );
    }
  }

  /** PROD connections of an engine with a fingerprint, filling in the ones created before it existed. */
  private async fingerprintedProds(dbType: DbTypeEnum): Promise<ConnectionEntity[]> {
    const prods = await this.repository.findActiveProd(dbType);
    for (const prod of prods) {
      if (prod.serverFingerprint) continue;
      const fingerprint = await this.read(prod);
      if (fingerprint) {
        await this.repository.saveServerFingerprint(prod.id, fingerprint);
        prod.serverFingerprint = fingerprint;
      }
    }
    return prods.filter((prod) => prod.serverFingerprint);
  }

  private async readPostgres(endpoint: ServerEndpoint): Promise<string> {
    const client = new Client({
      host: endpoint.host,
      port: endpoint.port,
      database: endpoint.database,
      user: endpoint.username,
      password: endpoint.password,
      connectionTimeoutMillis: FINGERPRINT_TIMEOUT_MS,
    });
    // An error on an idle socket would otherwise reach the process as an uncaughtException.
    client.on('error', () => undefined);
    try {
      await client.connect();
      const { rows } = await client.query<{ system_identifier: string; db: string }>(
        'SELECT system_identifier::text AS system_identifier, current_database() AS db FROM pg_control_system()',
      );
      return `${DbTypeEnum.POSTGRES}:${rows[0].system_identifier}/${rows[0].db}`;
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async readMysql(endpoint: ServerEndpoint): Promise<string> {
    const conn = await createMysqlConnection({
      host: endpoint.host,
      port: endpoint.port,
      database: endpoint.database,
      user: endpoint.username,
      password: endpoint.password,
      connectTimeout: FINGERPRINT_TIMEOUT_MS,
    });
    conn.on('error', () => undefined);
    try {
      const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT @@server_uuid AS uuid, DATABASE() AS db',
      );
      return `${DbTypeEnum.MYSQL}:${rows[0].uuid}/${rows[0].db}`;
    } finally {
      await conn.end().catch(() => undefined);
    }
  }
}
