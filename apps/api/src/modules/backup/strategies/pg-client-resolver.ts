import * as path from 'path';

/**
 * Pure rules that decide which PostgreSQL client (pg_dump / pg_restore) the
 * backup and restore strategies run. There is no I/O here: the installed
 * clients and the server / archive versions come in as arguments, so every
 * decision is covered by table tests.
 *
 * Upstream position (https://www.postgresql.org/docs/current/app-pgdump.html):
 * the output of pg_dump only loads into the same or a newer major. Restoring
 * into an older major is unsupported, and pg_dump / pg_restore 17+ also emit
 * `SET transaction_timeout = 0` (PostgreSQL 17+ only) which, inside the
 * `--single-transaction` restore, rolls the whole restore back on older servers.
 * So the API ships several client majors, dumps with the client of the source
 * major and restores only into the same or a newer major.
 */

export type PgTool = 'pg_dump' | 'pg_restore';

export interface PgClient {
  major: number;
  /** Directory holding the executables; '' means they are resolved from PATH. */
  binDir: string;
}

/** What the header of `pg_restore -l` says about an archive. */
export interface ArchiveHeader {
  /** Major of the server that was dumped ("Dumped from database version"). */
  serverMajor: number | null;
  /** Major of the pg_dump that wrote the archive ("Dumped by pg_dump version"). */
  dumpedByMajor: number | null;
}

export type PlanFailureCode =
  | 'no-clients'
  | 'server-newer-than-clients'
  | 'server-older-than-clients'
  | 'downgrade'
  | 'archive-newer-than-clients'
  | 'archive-too-new-for-target'
  | 'target-unsupported';

export interface PlanFailure {
  ok: false;
  code: PlanFailureCode;
  /** User-facing explanation (Spanish, like every API message). */
  message: string;
}

export interface BackupClientPlan {
  ok: true;
  clientMajor: number;
  binary: string;
}

export interface RestoreClientPlan {
  ok: true;
  clientMajor: number;
  binary: string;
  /** Non-blocking remark worth showing in the job log. */
  notice?: string;
}

export type BackupPlan = BackupClientPlan | PlanFailure;
export type RestorePlan = RestoreClientPlan | PlanFailure;

/**
 * Lowest server major that accepts every session SET a given pg_restore major
 * emits unconditionally. It only matters when a client has to restore into a
 * server older than itself, which happens for archives written by a newer
 * pg_dump than the server they came from (the legacy archives made when the
 * image shipped only pg_dump 18).
 *
 * - 17 and 18 emit `SET transaction_timeout = 0`, which every PostgreSQL 17+
 *   accepts; 16 and older reject it and roll the single-transaction restore back.
 * - A client with no entry is only trusted on its own major or newer, which is
 *   the upstream guarantee. Adding a client major (a future 19) is one line here
 *   once its output has been verified against older targets.
 */
export const MIN_TARGET_MAJOR_BY_CLIENT: ReadonlyMap<number, number> = new Map([
  [17, 17],
  [18, 17],
]);

export function minTargetMajorForClient(clientMajor: number): number {
  return MIN_TARGET_MAJOR_BY_CLIENT.get(clientMajor) ?? clientMajor;
}

/** "17.11", "16.4 (Debian 16.4-1.pgdg120+1)", "18beta1" -> 17, 16, 18. */
export function majorFromVersionString(
  version: string | null | undefined,
): number | null {
  const match = /^\s*(\d+)/.exec(version ?? '');
  return match ? Number(match[1]) : null;
}

/** `SHOW server_version_num`: 170011 -> 17, 90624 -> 9. */
export function majorFromServerVersionNum(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num / 10_000);
}

/**
 * Reads the two version lines of a `pg_restore -l` listing. They are comment
 * lines (they start with ';'), so an object that happens to carry the same
 * words in its name cannot be mistaken for them.
 */
export function parseArchiveHeader(listing: string): ArchiveHeader {
  const read = (label: string): number | null => {
    const match = new RegExp(`^;\\s*${label}:[ \\t]*(.+?)\\s*$`, 'm').exec(listing);
    return majorFromVersionString(match?.[1]);
  };

  return {
    serverMajor: read('Dumped from database version'),
    dumpedByMajor: read('Dumped by pg_dump version'),
  };
}

const NO_CLIENTS_MESSAGE =
  'No hay clientes de PostgreSQL (pg_dump / pg_restore) instalados en la API.';

const fail = (code: PlanFailureCode, message: string): PlanFailure => ({
  ok: false,
  code,
  message,
});

export class PgClientResolver {
  private readonly clients: ReadonlyMap<number, PgClient>;
  readonly installedMajors: readonly number[];

  constructor(clients: readonly PgClient[]) {
    this.clients = new Map(clients.map((client) => [client.major, client]));
    this.installedMajors = [...this.clients.keys()].sort((a, b) => a - b);
  }

  get newestMajor(): number | undefined {
    return this.installedMajors[this.installedMajors.length - 1];
  }

  binaryFor(tool: PgTool, major: number): string {
    const client = this.clients.get(major);
    if (!client) {
      throw new Error(
        `No hay un cliente de PostgreSQL ${major} instalado (instalados: ${this.describeInstalled()}).`,
      );
    }
    return client.binDir ? path.join(client.binDir, tool) : tool;
  }

  /**
   * The newest client reads every archive format, so it is the one that lists
   * archives (`pg_restore -l`) before the restore client is known.
   */
  newestBinaryFor(tool: PgTool): string {
    const newest = this.newestMajor;
    if (newest === undefined) throw new Error(NO_CLIENTS_MESSAGE);
    return this.binaryFor(tool, newest);
  }

  /**
   * Backup: dump with the client whose major equals the source server's.
   *
   * - Source newer than every client: refused (pg_dump itself refuses to dump
   *   a server newer than itself).
   * - Source older than the oldest client: refused. pg_dump could dump it, but
   *   the archive could never be restored: no supported client can load a
   *   server below the oldest installed major (see planRestore).
   * - Source in a gap between installed majors: the closest newer client is
   *   used; the restore side decides on the archive header which targets can
   *   load it.
   */
  planBackup(sourceMajor: number): BackupPlan {
    const newest = this.newestMajor;
    if (newest === undefined) return this.noClients();

    if (sourceMajor > newest) {
      return fail(
        'server-newer-than-clients',
        `El servidor de origen usa PostgreSQL ${sourceMajor}, más nuevo que los clientes instalados en la API (${this.describeInstalled()}). ` +
          `Actualice la imagen de la API para incluir pg_dump ${sourceMajor}.`,
      );
    }

    const oldest = this.installedMajors[0];
    if (sourceMajor < oldest) {
      return fail(
        'server-older-than-clients',
        `El servidor de origen usa PostgreSQL ${sourceMajor}, anterior a las versiones que la API puede respaldar y restaurar (${this.describeInstalled()}). ` +
          `Un respaldo de esa versión no podría restaurarse con los clientes instalados; actualice el servidor de origen a PostgreSQL ${oldest} o superior.`,
      );
    }

    const clientMajor = this.installedMajors.find((major) => major >= sourceMajor)!;
    return {
      ok: true,
      clientMajor,
      binary: this.binaryFor('pg_dump', clientMajor),
    };
  }

  /**
   * Restore: `archive` comes from the header of `pg_restore -l`, `targetMajor`
   * from the target server.
   *
   * 1. Target older than the source server: refused (unsupported downgrade).
   * 2. Archive written by a pg_dump newer than every client: refused (no
   *    installed pg_restore can read its format).
   * 3. Client: the one whose major equals the target's, among those able to read
   *    the archive (major >= the pg_dump that wrote it). When it is not
   *    installed, the closest older one; when there is none, the closest newer
   *    one. A target newer than every client uses the newest client.
   * 4. A client newer than the target (legacy archives, or a target below the
   *    oldest client) is accepted only when the target is at least
   *    `minTargetMajorForClient(client)`, so the SETs it emits are understood.
   */
  planRestore(input: { archive: ArchiveHeader; targetMajor: number }): RestorePlan {
    const { archive, targetMajor } = input;
    const newest = this.newestMajor;
    if (newest === undefined) return this.noClients();

    if (archive.serverMajor !== null && archive.serverMajor > targetMajor) {
      return fail('downgrade', downgradeMessage(archive.serverMajor, targetMajor));
    }

    const readableFrom = archive.dumpedByMajor ?? 0;
    if (readableFrom > newest) {
      return fail(
        'archive-newer-than-clients',
        `El archivo fue generado con pg_dump ${readableFrom}, más nuevo que los clientes instalados en la API (${this.describeInstalled()}). ` +
          `Actualice la imagen de la API para restaurarlo.`,
      );
    }

    const readers = this.installedMajors.filter((major) => major >= readableFrom);
    let notice: string | undefined;
    let clientMajor: number;

    if (readers.includes(targetMajor)) {
      clientMajor = targetMajor;
    } else if (targetMajor > newest) {
      clientMajor = newest;
      notice =
        `El servidor de destino usa PostgreSQL ${targetMajor}, más nuevo que el cliente más reciente instalado (${newest}); ` +
        `se usará pg_restore ${newest}.`;
    } else {
      const older = readers.filter((major) => major < targetMajor);
      clientMajor = older.length > 0 ? older[older.length - 1] : readers.find((major) => major > targetMajor)!;
    }

    if (clientMajor > targetMajor) {
      const minTarget = minTargetMajorForClient(clientMajor);
      if (targetMajor < minTarget) {
        if (archive.dumpedByMajor !== null && archive.dumpedByMajor > targetMajor) {
          // A new backup helps only when the source can still be backed up: its
          // version is known and inside the installed range (see planBackup).
          const canBackUpAgain =
            archive.serverMajor !== null &&
            archive.serverMajor >= this.installedMajors[0] &&
            archive.serverMajor <= newest;
          return fail(
            'archive-too-new-for-target',
            `El archivo fue generado con pg_dump ${archive.dumpedByMajor}, más nuevo que el servidor de destino (PostgreSQL ${targetMajor}), ` +
              `y su restauración falla en servidores anteriores a PostgreSQL ${minTarget}. ` +
              `Puede restaurarse en PostgreSQL ${minTarget} o superior.` +
              (canBackUpAgain
                ? ` Para restaurar en PostgreSQL ${targetMajor}, genere un respaldo nuevo del origen.`
                : ''),
          );
        }
        return fail(
          'target-unsupported',
          `PostgreSQL ${targetMajor} no está soportado como destino de restauración: los clientes instalados en la API son ${this.describeInstalled()}.`,
        );
      }
    }

    return {
      ok: true,
      clientMajor,
      binary: this.binaryFor('pg_restore', clientMajor),
      ...(notice ? { notice } : {}),
    };
  }

  private noClients(): PlanFailure {
    return fail('no-clients', NO_CLIENTS_MESSAGE);
  }

  private describeInstalled(): string {
    return this.installedMajors.length > 0
      ? `PostgreSQL ${this.installedMajors.join(', ')}`
      : 'ninguno';
  }
}

function downgradeMessage(sourceMajor: number, targetMajor: number): string {
  return (
    `No se puede restaurar un respaldo de PostgreSQL ${sourceMajor} en un servidor PostgreSQL ${targetMajor}: ` +
    `PostgreSQL solo garantiza cargar un respaldo en la misma versión mayor o en una más nueva. ` +
    `Seleccione un destino con PostgreSQL ${sourceMajor} o superior.`
  );
}
