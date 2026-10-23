/// <reference types="jest" />
import * as path from 'path';
import { sanitizeMessage } from '../../../common/sanitization/sanitize-message';
import {
  MIN_TARGET_MAJOR_BY_CLIENT,
  PgClient,
  PgClientResolver,
  majorFromServerVersionNum,
  majorFromVersionString,
  minTargetMajorForClient,
  parseArchiveHeader,
} from './pg-client-resolver';

const clientsFor = (majors: number[]): PgClient[] =>
  majors.map((major) => ({
    major,
    binDir: path.join('/usr/lib/postgresql', String(major), 'bin'),
  }));

const resolverFor = (majors: number[] = [14, 15, 16, 17, 18]) =>
  new PgClientResolver(clientsFor(majors));

const binary = (tool: string, major: number) =>
  path.join('/usr/lib/postgresql', String(major), 'bin', tool);

describe('version parsing', () => {
  it.each([
    ['17.11', 17],
    ['16.4 (Debian 16.4-1.pgdg120+1)', 16],
    ['18.0', 18],
    ['18beta1', 18],
    ['9.6.24', 9],
    ['  15.2', 15],
  ])('reads the major of the version string %p as %p', (value, expected) => {
    expect(majorFromVersionString(value)).toBe(expected);
  });

  it.each([['unknown'], [''], [undefined], [null], ['pg 17']])(
    'does not guess a major from %p',
    (value) => {
      expect(majorFromVersionString(value as string | null | undefined)).toBeNull();
    },
  );

  it.each([
    ['170011', 17],
    [180000, 18],
    ['160004', 16],
    ['90624', 9],
  ])('reads the major of server_version_num %p as %p', (value, expected) => {
    expect(majorFromServerVersionNum(value)).toBe(expected);
  });

  it.each([['abc'], [''], [undefined], [null], [0], ['-5']])(
    'rejects server_version_num %p',
    (value) => {
      expect(majorFromServerVersionNum(value as string | number | null | undefined)).toBeNull();
    },
  );
});

describe('parseArchiveHeader', () => {
  const toc = (serverVersion: string, dumperVersion: string) =>
    [
      ';',
      '; Archive created at 2026-10-23 10:00:00 UTC',
      ';     dbname: testdb',
      ';     TOC Entries: 12',
      ';     Compression: gzip',
      ';     Dump Version: 1.16-0',
      ';     Format: CUSTOM',
      ';     Integer: 4 bytes',
      ';     Offset: 8 bytes',
      `;     Dumped from database version: ${serverVersion}`,
      `;     Dumped by pg_dump version: ${dumperVersion}`,
      ';',
      ';',
      '; Selected TOC Entries:',
      ';',
      '217; 1259 16390 TABLE public e2e_items test_user',
    ].join('\n');

  it('reads the server and dumper majors from the header of pg_restore -l', () => {
    expect(parseArchiveHeader(toc('17.11', '18.0 (Debian 18.0-1.pgdg12+3)'))).toEqual({
      serverMajor: 17,
      dumpedByMajor: 18,
    });
  });

  it('tolerates CRLF line endings', () => {
    expect(parseArchiveHeader(toc('16.4', '16.4').replace(/\n/g, '\r\n'))).toEqual({
      serverMajor: 16,
      dumpedByMajor: 16,
    });
  });

  it('returns nulls when the header lines are missing', () => {
    expect(parseArchiveHeader('; nothing useful here\n')).toEqual({
      serverMajor: null,
      dumpedByMajor: null,
    });
  });

  it('ignores a "Dumped from" text that sits inside an object name, not in the header', () => {
    const output = toc('17.1', '17.1') + '\n217; 1259 16390 TABLE public "Dumped by pg_dump version: 99"';
    expect(parseArchiveHeader(output).dumpedByMajor).toBe(17);
  });
});

describe('minTargetMajorForClient', () => {
  it('lets pg_restore 17 and 18 restore into PostgreSQL 17 (they emit SET transaction_timeout)', () => {
    expect(minTargetMajorForClient(17)).toBe(17);
    expect(minTargetMajorForClient(18)).toBe(17);
  });

  it('only guarantees the same major for clients with no entry in the table', () => {
    expect(minTargetMajorForClient(16)).toBe(16);
    expect(minTargetMajorForClient(14)).toBe(14);
    expect(minTargetMajorForClient(19)).toBe(19);
  });

  it('keeps the table explicit so a new client major is a one-line change', () => {
    expect([...MIN_TARGET_MAJOR_BY_CLIENT.entries()]).toEqual([
      [17, 17],
      [18, 17],
    ]);
  });
});

describe('PgClientResolver', () => {
  describe('failure messages', () => {
    // A failed job stores sanitizeMessage(message): first line only, at most 500
    // characters, with host / path / address patterns redacted. Every refusal
    // must reach the user whole.
    const failures = () => {
      const resolver = resolverFor();
      const archive = (serverMajor: number | null, dumpedByMajor: number | null) => ({
        serverMajor,
        dumpedByMajor,
      });
      return [
        resolver.planBackup(19),
        resolver.planBackup(13),
        new PgClientResolver([]).planBackup(17),
        resolver.planRestore({ archive: archive(17, 17), targetMajor: 16 }),
        resolver.planRestore({ archive: archive(19, 19), targetMajor: 19 }),
        resolver.planRestore({ archive: archive(16, 18), targetMajor: 16 }),
        resolver.planRestore({ archive: archive(13, 18), targetMajor: 13 }),
        resolver.planRestore({ archive: archive(13, 13), targetMajor: 13 }),
      ];
    };

    it.each(failures().map((plan, index) => [index, plan] as const))(
      'case %# survives sanitizeMessage unchanged',
      (_index, plan) => {
        expect(plan.ok).toBe(false);
        if (!plan.ok) {
          expect(sanitizeMessage(plan.message)).toBe(plan.message);
        }
      },
    );
  });

  describe('binaryFor', () => {
    it('builds the absolute path of the tool for an installed major', () => {
      const resolver = resolverFor();
      expect(resolver.binaryFor('pg_dump', 16)).toBe(binary('pg_dump', 16));
      expect(resolver.binaryFor('pg_restore', 18)).toBe(binary('pg_restore', 18));
    });

    it('uses the bare tool name for clients found on PATH', () => {
      const resolver = new PgClientResolver([{ major: 17, binDir: '' }]);
      expect(resolver.binaryFor('pg_dump', 17)).toBe('pg_dump');
      expect(resolver.binaryFor('pg_restore', 17)).toBe('pg_restore');
    });

    it('throws for a major that is not installed', () => {
      expect(() => resolverFor().binaryFor('pg_dump', 13)).toThrow(/13/);
    });
  });

  describe('newestBinaryFor', () => {
    it('returns the tool of the newest client, the one that lists every archive format', () => {
      expect(resolverFor([16, 18, 17]).newestBinaryFor('pg_restore')).toBe(
        binary('pg_restore', 18),
      );
    });

    it('throws a clear message when no client is installed', () => {
      expect(() => new PgClientResolver([]).newestBinaryFor('pg_restore')).toThrow(
        'No hay clientes de PostgreSQL',
      );
    });
  });

  describe('installed majors', () => {
    it('are sorted, unique and expose the newest', () => {
      const resolver = new PgClientResolver(clientsFor([17, 14, 18, 14]));
      expect(resolver.installedMajors).toEqual([14, 17, 18]);
      expect(resolver.newestMajor).toBe(18);
    });

    it('has no newest major when nothing is installed', () => {
      expect(new PgClientResolver([]).newestMajor).toBeUndefined();
    });
  });

  describe('planBackup', () => {
    it.each([14, 15, 16, 17, 18])('dumps a PostgreSQL %p server with the client of the same major', (major) => {
      expect(resolverFor().planBackup(major)).toEqual({
        ok: true,
        clientMajor: major,
        binary: binary('pg_dump', major),
      });
    });

    it('refuses a source newer than the newest installed client', () => {
      const plan = resolverFor().planBackup(19);
      expect(plan).toMatchObject({ ok: false, code: 'server-newer-than-clients' });
      if (!plan.ok) {
        expect(plan.message).toContain('PostgreSQL 19');
        expect(plan.message).toContain('18');
      }
    });

    it('refuses a source older than the oldest client: its archive could never be restored', () => {
      const plan = resolverFor().planBackup(13);
      expect(plan).toMatchObject({ ok: false, code: 'server-older-than-clients' });
      if (!plan.ok) {
        expect(plan.message).toContain('PostgreSQL 13');
        expect(plan.message).toContain('PostgreSQL 14');
        expect(plan.message).toContain('actualice');
      }
    });

    it('uses the closest newer client when the exact major is not installed', () => {
      expect(resolverFor([14, 16, 18]).planBackup(15)).toMatchObject({
        ok: true,
        clientMajor: 16,
      });
    });

    it('fails with a clear message when no client is installed', () => {
      expect(new PgClientResolver([]).planBackup(17)).toMatchObject({
        ok: false,
        code: 'no-clients',
      });
    });
  });

  describe('planRestore', () => {
    const archive = (serverMajor: number | null, dumpedByMajor: number | null) => ({
      serverMajor,
      dumpedByMajor,
    });

    describe('same or newer target', () => {
      it.each([14, 15, 16, 17, 18])(
        'restores a PostgreSQL %p archive made by its own pg_dump into the same major with that client',
        (major) => {
          expect(
            resolverFor().planRestore({ archive: archive(major, major), targetMajor: major }),
          ).toEqual({ ok: true, clientMajor: major, binary: binary('pg_restore', major) });
        },
      );

      it('restores an older source into a newer target using the client of the target major', () => {
        expect(
          resolverFor().planRestore({ archive: archive(15, 15), targetMajor: 17 }),
        ).toMatchObject({ ok: true, clientMajor: 17 });
      });

      it('restores a PostgreSQL 16 archive into PostgreSQL 18 with the 18 client', () => {
        expect(
          resolverFor().planRestore({ archive: archive(16, 16), targetMajor: 18 }),
        ).toMatchObject({ ok: true, clientMajor: 18 });
      });
    });

    describe('downgrade', () => {
      it.each([
        [17, 17, 16],
        [18, 18, 17],
        [18, 18, 14],
        [16, 18, 15],
      ])(
        'blocks restoring a PostgreSQL %p server archive (dumped by %p) into PostgreSQL %p',
        (server, dumper, target) => {
          const plan = resolverFor().planRestore({
            archive: archive(server, dumper),
            targetMajor: target,
          });
          expect(plan).toMatchObject({ ok: false, code: 'downgrade' });
          if (!plan.ok) {
            expect(plan.message).toContain(`PostgreSQL ${server}`);
            expect(plan.message).toContain(`PostgreSQL ${target}`);
          }
        },
      );
    });

    describe('legacy archives made by a newer pg_dump than the source server', () => {
      it.each([17, 18])(
        'restores a pg_dump 18 archive of a PostgreSQL 17 server into PostgreSQL %p (production today)',
        (target) => {
          expect(
            resolverFor().planRestore({ archive: archive(17, 18), targetMajor: target }),
          ).toEqual({ ok: true, clientMajor: 18, binary: binary('pg_restore', 18) });
        },
      );

      it('restores a pg_dump 18 archive of a PostgreSQL 16 server into PostgreSQL 17 with the 18 client', () => {
        expect(
          resolverFor().planRestore({ archive: archive(16, 18), targetMajor: 17 }),
        ).toMatchObject({ ok: true, clientMajor: 18 });
      });

      it.each([14, 15, 16])(
        'blocks a pg_dump 18 archive of a PostgreSQL %p server into PostgreSQL %p, points to PostgreSQL 17 or newer and to a new backup',
        (version) => {
          const plan = resolverFor().planRestore({
            archive: archive(version, 18),
            targetMajor: version,
          });
          expect(plan).toMatchObject({ ok: false, code: 'archive-too-new-for-target' });
          if (!plan.ok) {
            expect(plan.message).toContain('pg_dump 18');
            expect(plan.message).toContain('PostgreSQL 17 o superior');
            expect(plan.message).toContain('genere un respaldo nuevo');
          }
        },
      );

      it.each([
        ['a source below the oldest client, whose new backup would be refused', archive(13, 18), 13],
        ['a source of unknown version', archive(null, 17), 16],
      ])(
        'does not suggest a new backup when it cannot help (%s)',
        (_title, header, target) => {
          const plan = resolverFor().planRestore({ archive: header, targetMajor: target });
          expect(plan).toMatchObject({ ok: false, code: 'archive-too-new-for-target' });
          if (!plan.ok) {
            expect(plan.message).toContain('o superior');
            expect(plan.message).not.toContain('respaldo nuevo');
          }
        },
      );
    });

    describe('archives of unknown origin', () => {
      it('uses the client of the target major when the header carries no versions', () => {
        expect(
          resolverFor().planRestore({ archive: archive(null, null), targetMajor: 16 }),
        ).toMatchObject({ ok: true, clientMajor: 16 });
      });

      it('cannot detect a downgrade without the source major, so it relies on the target client', () => {
        expect(
          resolverFor().planRestore({ archive: archive(null, 17), targetMajor: 16 }),
        ).toMatchObject({ ok: false, code: 'archive-too-new-for-target' });
      });
    });

    describe('unsupported majors', () => {
      it('blocks a target older than the oldest client', () => {
        const plan = resolverFor().planRestore({ archive: archive(13, 13), targetMajor: 13 });
        expect(plan).toMatchObject({ ok: false, code: 'target-unsupported' });
        if (!plan.ok) {
          expect(plan.message).toContain('PostgreSQL 13');
          expect(plan.message).toContain('14');
        }
      });

      it('blocks an archive written by a pg_dump newer than every installed client', () => {
        const plan = resolverFor().planRestore({ archive: archive(19, 19), targetMajor: 19 });
        expect(plan).toMatchObject({ ok: false, code: 'archive-newer-than-clients' });
      });

      it('restores into a target newer than every client with the newest client and says so', () => {
        const plan = resolverFor().planRestore({ archive: archive(17, 17), targetMajor: 19 });
        expect(plan).toMatchObject({ ok: true, clientMajor: 18 });
        if (plan.ok) {
          expect(plan.notice).toMatch(/PostgreSQL 19/);
        }
      });

      it('fails with a clear message when no client is installed', () => {
        expect(
          new PgClientResolver([]).planRestore({ archive: archive(17, 17), targetMajor: 17 }),
        ).toMatchObject({ ok: false, code: 'no-clients' });
      });

      it('picks the closest older client when the target major is not installed', () => {
        expect(
          resolverFor([14, 16, 18]).planRestore({ archive: archive(15, 15), targetMajor: 17 }),
        ).toMatchObject({ ok: true, clientMajor: 16 });
      });
    });
  });
});
