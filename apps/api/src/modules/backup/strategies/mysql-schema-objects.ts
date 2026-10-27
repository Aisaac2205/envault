import { sanitizeMessage } from '../../../common/sanitization/sanitize-message';

/**
 * Views, triggers, stored routines and events of a MySQL database.
 *
 * `RENAME TABLE` cannot move a table that has triggers to another database
 * (ER_TRG_IN_WRONG_SCHEMA) nor a view (ER_FORBID_SCHEMA_CHANGE), and routines
 * and events are bound to their schema, so the restore swaps BASE TABLEs only
 * and recreates these objects in the target from their captured definitions.
 */

/** The slice of a mysql2 connection this module needs (one session). */
export interface MysqlSession {
  query(sql: string, values?: unknown[]): Promise<unknown>;
}

export type RoutineKind = 'PROCEDURE' | 'FUNCTION';

/** Session state a definition was created under, as `SHOW CREATE ...` reports it. */
export interface SessionContext {
  sqlMode?: string;
  charset?: string;
  collation?: string;
  timeZone?: string;
}

export interface CapturedObject {
  name: string;
  ddl: string;
  context: SessionContext;
}

export interface CapturedTrigger extends CapturedObject {
  table: string;
}

export interface CapturedRoutine extends CapturedObject {
  kind: RoutineKind;
}

export interface CapturedSchemaObjects {
  routines: CapturedRoutine[];
  views: CapturedObject[];
  /** In creation order: per table, timing, event and ACTION_ORDER. */
  triggers: CapturedTrigger[];
  events: CapturedObject[];
}

export interface SwapOptions {
  database: string;
  shadowDb: string;
  backupDb: string;
  onLog: (message: string) => void;
  abortSignal?: AbortSignal;
  /** The session's lock_wait_timeout in seconds; only used to word a timeout. */
  lockWaitTimeoutSeconds?: number;
}

const CANCELLED_MESSAGE = 'Operación cancelada por el usuario';

/** What the rollback learned before it failed, so the error can say where the data is. */
export interface RollbackState {
  /** Whether the base tables were swapped; undefined when that could not be determined. */
  renamed?: boolean;
  /** Triggers and views of the target that may still be missing ("trigger x", "view y"). */
  missing?: string[];
}

/**
 * Thrown when the swap failed and the target could not be put back as it was.
 * Once the tables were swapped, `<db>_pre_restore_<ts>` holds the original data
 * and must not be dropped. Before the swap the tables never left the target and
 * that database is empty, which `backupIsEmpty` reports only when it was verified.
 */
export class RestoreRollbackError extends Error {
  /** True only when the pre-restore database is known to hold no base tables. */
  readonly backupIsEmpty: boolean;

  constructor(
    readonly backupDb: string,
    cause: unknown,
    rollbackCause: unknown,
    state: RollbackState = {},
  ) {
    super(
      `Restore failed (${errorText(cause)}) and the rollback also failed (${errorText(rollbackCause)}). ` +
        rollbackAdvice(backupDb, state),
    );
    this.name = 'RestoreRollbackError';
    this.backupIsEmpty = state.renamed === false;
  }
}

function rollbackAdvice(backupDb: string, { renamed, missing = [] }: RollbackState): string {
  if (renamed === undefined) {
    return `The original tables may be in the target database or in ${backupDb}, which was kept.`;
  }
  if (renamed) {
    return `The original tables are preserved in database ${backupDb}.`;
  }
  const advice = `The original tables were not moved: they are still in the target database and ${backupDb} is empty.`;
  return missing.length === 0
    ? advice
    : `${advice} These objects may still be missing from the target and must be recreated by hand: ${missing.join(', ')}.`;
}

/** mysql2 errno 1205, raised for metadata lock waits and InnoDB row lock waits alike. */
function isLockWaitTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { errno, code } = error as { errno?: unknown; code?: unknown };
  return errno === 1205 || code === 'ER_LOCK_WAIT_TIMEOUT';
}

/** How far the swap got, so the rollback undoes only what was done. */
type SwapStage = 'reading-definitions' | 'dropping-blockers' | 'renaming' | 'recreating-objects';

const STAGE_LABELS: Record<SwapStage, string> = {
  'reading-definitions': 'reading the object definitions',
  'dropping-blockers': 'dropping the triggers and views of the target',
  renaming: 'renaming the tables',
  'recreating-objects': 'recreating the restored objects',
};

/**
 * A lock wait timeout becomes a message naming the stage, in place of MySQL's
 * "try restarting transaction". `unchanged` is only set once the target is known
 * to be as it was. Any other error passes through.
 */
function describeFailure(
  error: unknown,
  stage: SwapStage,
  lockWaitSeconds: number | undefined,
  unchanged: boolean,
): unknown {
  if (!isLockWaitTimeout(error)) return error;
  const waited = lockWaitSeconds === undefined ? 'Timed out' : `Timed out after ${lockWaitSeconds} s`;
  const message =
    `${waited} waiting for a lock on the target database while ${STAGE_LABELS[stage]}; ` +
    'another session is using the target tables';
  return new Error(unchanged ? `${message}. The target was left unchanged.` : message);
}

export function quoteId(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``;
}

function errorText(error: unknown): string {
  return sanitizeMessage(error instanceof Error ? error.message : String(error));
}

async function rows<T>(
  session: MysqlSession,
  sql: string,
  values?: unknown[],
): Promise<T[]> {
  const result = (await session.query(sql, values)) as [T[], unknown];
  return result[0];
}

async function useDatabase(session: MysqlSession, database: string): Promise<void> {
  await session.query(`USE ${quoteId(database)}`);
}

export async function listBaseTables(
  session: MysqlSession,
  database: string,
): Promise<string[]> {
  const result = await rows<{ name: string }>(
    session,
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
    [database],
  );
  return result.map((row) => row.name);
}

async function names(
  session: MysqlSession,
  sql: string,
  database: string,
): Promise<string[]> {
  const result = await rows<{ name: string }>(session, sql, [database]);
  return result.map((row) => row.name);
}

async function listViewNames(session: MysqlSession, database: string): Promise<string[]> {
  return names(
    session,
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'VIEW' ORDER BY TABLE_NAME",
    database,
  );
}

async function listTriggerNames(session: MysqlSession, database: string): Promise<string[]> {
  return names(
    session,
    'SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME',
    database,
  );
}

type Row = Record<string, unknown>;

function definition(row: Row, column: string, objectName: string): string {
  const value = row[column];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Cannot read the definition of ${objectName} (insufficient privileges to SHOW CREATE)`,
    );
  }
  return value;
}

function contextOf(row: Row, withMode: boolean, withTimeZone = false): SessionContext {
  const text = (key: string): string | undefined =>
    typeof row[key] === 'string' ? (row[key] as string) : undefined;
  return {
    sqlMode: withMode ? text('sql_mode') : undefined,
    charset: text('character_set_client'),
    collation: text('collation_connection'),
    timeZone: withTimeZone ? text('time_zone') : undefined,
  };
}

async function showCreate(session: MysqlSession, statement: string): Promise<Row> {
  const result = await rows<Row>(session, statement);
  return result[0] ?? {};
}

/**
 * Reads the definitions of every view, trigger, routine and event of
 * `database`. `SHOW CREATE VIEW` is only unqualified under `USE <db>`, so the
 * session's default database is switched to the captured one.
 */
export async function captureSchemaObjects(
  session: MysqlSession,
  database: string,
): Promise<CapturedSchemaObjects> {
  await useDatabase(session, database);

  const viewNames = await listViewNames(session, database);
  const views: CapturedObject[] = [];
  for (const name of viewNames) {
    const row = await showCreate(session, `SHOW CREATE VIEW ${quoteId(name)}`);
    views.push({
      name,
      ddl: definition(row, 'Create View', `view ${name}`),
      context: contextOf(row, false),
    });
  }

  const triggerRows = await rows<{ name: string; tableName: string }>(
    session,
    'SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS tableName FROM information_schema.TRIGGERS ' +
      'WHERE TRIGGER_SCHEMA = ? ORDER BY EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_ORDER',
    [database],
  );
  const triggers: CapturedTrigger[] = [];
  for (const { name, tableName } of triggerRows) {
    const row = await showCreate(session, `SHOW CREATE TRIGGER ${quoteId(name)}`);
    triggers.push({
      name,
      table: tableName,
      ddl: definition(row, 'SQL Original Statement', `trigger ${name}`),
      context: contextOf(row, true),
    });
  }

  const routineRows = await rows<{ name: string; kind: RoutineKind }>(
    session,
    'SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS kind FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_TYPE, ROUTINE_NAME',
    [database],
  );
  const routines: CapturedRoutine[] = [];
  for (const { name, kind } of routineRows) {
    const row = await showCreate(session, `SHOW CREATE ${kind} ${quoteId(name)}`);
    const column = kind === 'PROCEDURE' ? 'Create Procedure' : 'Create Function';
    routines.push({
      name,
      kind,
      ddl: definition(row, column, `${kind.toLowerCase()} ${name}`),
      context: contextOf(row, true),
    });
  }

  const eventNames = await names(
    session,
    'SELECT EVENT_NAME AS name FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME',
    database,
  );
  const events: CapturedObject[] = [];
  for (const name of eventNames) {
    const row = await showCreate(session, `SHOW CREATE EVENT ${quoteId(name)}`);
    events.push({
      name,
      ddl: definition(row, 'Create Event', `event ${name}`),
      context: contextOf(row, true, true),
    });
  }

  return { routines, views, triggers, events };
}

const CONTEXT_VARIABLES: ReadonlyArray<[keyof SessionContext, string]> = [
  ['sqlMode', 'sql_mode'],
  ['charset', 'character_set_client'],
  ['collation', 'collation_connection'],
  ['timeZone', 'time_zone'],
];

async function applyContext(session: MysqlSession, context: SessionContext): Promise<void> {
  const assignments: string[] = [];
  const values: string[] = [];
  for (const [key, variable] of CONTEXT_VARIABLES) {
    const value = context[key];
    if (value !== undefined) {
      assignments.push(`@@SESSION.${variable} = ?`);
      values.push(value);
    }
  }
  if (assignments.length > 0) {
    await session.query(`SET ${assignments.join(', ')}`, values);
  }
}

async function readSessionContext(session: MysqlSession): Promise<SessionContext> {
  const [row] = await rows<{
    sqlMode: string;
    charset: string;
    collation: string;
    timeZone: string;
  }>(
    session,
    'SELECT @@SESSION.sql_mode AS sqlMode, @@SESSION.character_set_client AS charset, ' +
      '@@SESSION.collation_connection AS collation, @@SESSION.time_zone AS timeZone',
  );
  return row;
}

async function createWithContext(
  session: MysqlSession,
  object: CapturedObject,
  original: SessionContext,
): Promise<void> {
  try {
    await applyContext(session, object.context);
    await session.query(object.ddl);
  } finally {
    await applyContext(session, original);
  }
}

/**
 * Views may select from other views and call functions, so they are created
 * with a bounded retry-until-no-progress loop: each pass creates what it can,
 * and a pass that creates nothing fails with the last error.
 */
async function createViews(
  session: MysqlSession,
  views: CapturedObject[],
  original: SessionContext,
): Promise<void> {
  let pending = views;
  while (pending.length > 0) {
    const failed: CapturedObject[] = [];
    let lastError: unknown;
    for (const view of pending) {
      try {
        await createWithContext(session, view, original);
      } catch (error) {
        failed.push(view);
        lastError = error;
      }
    }
    if (failed.length === pending.length) {
      throw new Error(
        `Could not create view(s) ${failed.map((v) => v.name).join(', ')}: ${errorText(lastError)}`,
      );
    }
    pending = failed;
  }
}

/**
 * Creates the objects in `database`, in dependency order: routines, views,
 * triggers (already in ACTION_ORDER), events. Each definition runs under its
 * captured session context, and the session is restored afterwards.
 */
export async function createSchemaObjects(
  session: MysqlSession,
  database: string,
  objects: CapturedSchemaObjects,
): Promise<void> {
  await useDatabase(session, database);
  const original = await readSessionContext(session);
  for (const routine of objects.routines) {
    await createWithContext(session, routine, original);
  }
  await createViews(session, objects.views, original);
  for (const trigger of objects.triggers) {
    await createWithContext(session, trigger, original);
  }
  for (const event of objects.events) {
    await createWithContext(session, event, original);
  }
}

function dropStatements(database: string, objects: CapturedSchemaObjects, which: {
  triggers?: boolean;
  views?: boolean;
  routines?: boolean;
  events?: boolean;
}): string[] {
  const db = quoteId(database);
  const statements: string[] = [];
  if (which.triggers) {
    for (const t of objects.triggers) statements.push(`DROP TRIGGER IF EXISTS ${db}.${quoteId(t.name)}`);
  }
  if (which.views) {
    for (const v of objects.views) statements.push(`DROP VIEW IF EXISTS ${db}.${quoteId(v.name)}`);
  }
  if (which.routines) {
    for (const r of objects.routines) {
      statements.push(`DROP ${r.kind} IF EXISTS ${db}.${quoteId(r.name)}`);
    }
  }
  if (which.events) {
    for (const e of objects.events) statements.push(`DROP EVENT IF EXISTS ${db}.${quoteId(e.name)}`);
  }
  return statements;
}

async function run(session: MysqlSession, statements: string[]): Promise<void> {
  for (const statement of statements) {
    await session.query(statement);
  }
}

function renameStatement(
  moves: Array<{ from: string; to: string; tables: string[] }>,
): string | null {
  const pairs = moves.flatMap(({ from, to, tables }) =>
    tables.map((t) => `${quoteId(from)}.${quoteId(t)} TO ${quoteId(to)}.${quoteId(t)}`),
  );
  return pairs.length > 0 ? `RENAME TABLE ${pairs.join(', ')}` : null;
}

async function renameWithoutForeignKeyChecks(
  session: MysqlSession,
  statement: string | null,
): Promise<void> {
  if (statement === null) return;
  await session.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await session.query(statement);
  } finally {
    await session.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => undefined);
  }
}

/**
 * Whether the rename happened, read from the databases and not assumed: the
 * shadow is emptied by it (the swap refuses an empty shadow, so empty means
 * moved). When it did not happen the pre-restore database must be empty too;
 * if it is not, the state is not what this code assumes and nothing is certain.
 */
async function hasRenamed(
  session: MysqlSession,
  { shadowDb, backupDb }: SwapOptions,
  stage: SwapStage,
): Promise<boolean | undefined> {
  if (stage !== 'dropping-blockers' && (await listBaseTables(session, shadowDb)).length === 0) {
    return true;
  }
  return (await listBaseTables(session, backupDb)).length === 0 ? false : undefined;
}

type DroppedObjects = Pick<CapturedSchemaObjects, 'views' | 'triggers'>;

/** The target's own views and triggers that it does not have right now. */
async function missingFromTarget(
  session: MysqlSession,
  database: string,
  original: CapturedSchemaObjects,
): Promise<DroppedObjects> {
  const views = new Set(await listViewNames(session, database));
  const triggers = new Set(await listTriggerNames(session, database));
  return {
    views: original.views.filter((v) => !views.has(v.name)),
    triggers: original.triggers.filter((t) => !triggers.has(t.name)),
  };
}

function labelsOf({ views, triggers }: DroppedObjects): string[] {
  return [...views.map((v) => `view ${v.name}`), ...triggers.map((t) => `trigger ${t.name}`)];
}

/**
 * Puts the target back as it was before the critical section began.
 *
 * Before the rename only the target's triggers and views were touched, so only
 * those that are missing are recreated: no DROP is repeated, because whatever
 * blocked the first one (a lock held by another session) would block it again
 * and strand objects that were never touched. Routines and events were not
 * dropped and recreating them would add failure points. Once the rename has
 * happened every object name involved is dropped with IF EXISTS, the rename is
 * reversed, and all of the target's own objects are recreated from their
 * captured definitions. `state` records what was learned, for the error.
 */
async function rollback(
  session: MysqlSession,
  options: SwapOptions,
  stage: SwapStage,
  originalTables: string[],
  shadowTables: string[],
  original: CapturedSchemaObjects,
  shadow: CapturedSchemaObjects,
  state: RollbackState,
): Promise<void> {
  const { database, shadowDb, backupDb } = options;

  state.renamed = await hasRenamed(session, options, stage);
  if (state.renamed === undefined) {
    throw new Error(`Cannot tell whether the tables of ${database} were swapped`);
  }
  if (!state.renamed) {
    // Until the check says otherwise, any of them may be missing.
    state.missing = labelsOf(original);
    const missing = await missingFromTarget(session, database, original);
    state.missing = labelsOf(missing);
    try {
      await createSchemaObjects(session, database, { routines: [], events: [], ...missing });
    } catch (error) {
      // Narrow the list to what is still missing, if that can be read.
      await missingFromTarget(session, database, original).then(
        (left) => (state.missing = labelsOf(left)),
        () => undefined,
      );
      throw error;
    }
    return;
  }

  const all = { triggers: true, views: true, routines: true, events: true };
  await run(session, [
    ...dropStatements(database, shadow, all),
    ...dropStatements(database, original, all),
  ]);

  await renameWithoutForeignKeyChecks(
    session,
    renameStatement([
      { from: database, to: shadowDb, tables: shadowTables },
      { from: backupDb, to: database, tables: originalTables },
    ]),
  );

  await createSchemaObjects(session, database, original);
}

/**
 * Swaps the restored shadow database into the target. Base tables move in one
 * atomic RENAME TABLE; views, triggers, routines and events are recreated
 * around it. Triggers and the target's views are dropped first because they
 * block the rename, so tables are briefly without them.
 *
 * Once the critical section begins it is never aborted midway: it either
 * finishes or is rolled back. A cancellation is honored only before it.
 */
export async function swapSchemaObjects(
  session: MysqlSession,
  options: SwapOptions,
): Promise<void> {
  const { database, shadowDb, backupDb, onLog, abortSignal } = options;

  const lockWaitSeconds = options.lockWaitTimeoutSeconds;
  const originalTables = await listBaseTables(session, database);
  const shadowTables = await listBaseTables(session, shadowDb);
  // The rollback reads "the shadow has no base tables" as "the rename already
  // happened", so an empty shadow would make it undo a rename that never ran.
  // Refused before the `try` so that no rollback is attempted for it.
  if (shadowTables.length === 0) {
    throw new Error(
      `Cannot swap: shadow database ${shadowDb} has no base tables, the target was not touched`,
    );
  }
  let original: CapturedSchemaObjects;
  let shadow: CapturedSchemaObjects;
  try {
    original = await captureSchemaObjects(session, database);
    shadow = await captureSchemaObjects(session, shadowDb);
  } catch (error) {
    // Nothing was changed yet, so there is nothing to roll back.
    throw describeFailure(error, 'reading-definitions', lockWaitSeconds, true);
  }

  if (abortSignal?.aborted) {
    throw new Error(CANCELLED_MESSAGE);
  }

  let stage: SwapStage = 'dropping-blockers';
  try {
    await run(session, [
      ...dropStatements(database, original, { triggers: true, views: true }),
      ...dropStatements(shadowDb, shadow, { triggers: true }),
    ]);

    stage = 'renaming';
    await renameWithoutForeignKeyChecks(
      session,
      renameStatement([
        { from: database, to: backupDb, tables: originalTables },
        { from: shadowDb, to: database, tables: shadowTables },
      ]),
    );
    onLog(
      `Swapped ${originalTables.length} original -> backup, ${shadowTables.length} shadow -> original`,
    );

    stage = 'recreating-objects';
    await run(
      session,
      dropStatements(database, original, { routines: true, events: true }),
    );
    await createSchemaObjects(session, database, shadow);
    onLog(
      `Restored ${shadow.views.length} views, ${shadow.triggers.length} triggers, ` +
        `${shadow.routines.length} routines, ${shadow.events.length} events`,
    );
  } catch (error) {
    onLog('Restore swap failed, rolling back the target database');
    const state: RollbackState = {};
    try {
      await rollback(session, options, stage, originalTables, shadowTables, original, shadow, state);
    } catch (rollbackError) {
      throw new RestoreRollbackError(
        backupDb,
        describeFailure(error, stage, lockWaitSeconds, false),
        rollbackError,
        state,
      );
    }
    throw describeFailure(error, stage, lockWaitSeconds, true);
  }
}
