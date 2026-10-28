import { buildBackupAnalyticsSource } from './backup-analytics-source';

const RANGE = { from: '2026-03-01', toExclusive: '2026-03-08' };
const CONNECTION_ID = '6c1f2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('buildBackupAnalyticsSource', () => {
  it('binds the range and the two counted statuses as $1..$4, without a connection filter', () => {
    const { sql, params } = buildBackupAnalyticsSource(RANGE);

    expect(params).toEqual(['2026-03-01', '2026-03-08', 'completed', 'failed']);
    expect(sql).not.toContain('$5');
  });

  it('adds the connection as $5 in the live rows and in both rollup sources', () => {
    const { sql, params } = buildBackupAnalyticsSource({ ...RANGE, connectionId: CONNECTION_ID });

    expect(params).toEqual(['2026-03-01', '2026-03-08', 'completed', 'failed', CONNECTION_ID]);
    expect(sql.match(/"connectionId" = \$5/g)).toHaveLength(3);
  });

  it('ignores a null connectionId', () => {
    const { sql, params } = buildBackupAnalyticsSource({ ...RANGE, connectionId: null });

    expect(params).toHaveLength(4);
    expect(sql).not.toContain('$5');
  });

  it('never interpolates a value into the SQL text', () => {
    const { sql } = buildBackupAnalyticsSource({ ...RANGE, connectionId: CONNECTION_ID });

    expect(sql).not.toContain('2026-03');
    expect(sql).not.toContain(CONNECTION_ID);
  });

  it('merges the live rows, the rollup counts and the purged durations', () => {
    const { sql } = buildBackupAnalyticsSource(RANGE);

    expect(sql).toContain('FROM backup_jobs j');
    expect(sql).toContain('FROM backup_daily_rollups r');
    expect(sql).toContain('unnest(r."durationsSeconds")');
    expect(sql.match(/UNION ALL/g)).toHaveLength(2);
  });

  it('exposes the same columns from every source: connectionId, day, completed, failed, sizeMb and duration', () => {
    const { sql } = buildBackupAnalyticsSource(RANGE);

    for (const column of ['"connectionId"', '"day"', '"completed"', '"failed"', '"sizeMb"', '"duration"']) {
      expect(sql).toContain(`AS ${column}`);
    }
  });
});
