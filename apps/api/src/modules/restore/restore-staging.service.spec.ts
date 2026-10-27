import { createHash } from 'crypto';
import { mkdtemp, lstat, readFile, rm, symlink, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import {
  RestoreStagingLock,
  RestoreStagingOwnership,
  RestoreStagingService,
} from './restore-staging.service';

class FakeOwnership implements RestoreStagingOwnership {
  private readonly lockedTargets = new Set<string>();

  lock(targetConnectionId: string): void {
    this.lockedTargets.add(targetConnectionId);
  }

  async tryAcquire(targetConnectionId: string): Promise<RestoreStagingLock | null> {
    if (this.lockedTargets.has(targetConnectionId)) return null;
    this.lockedTargets.add(targetConnectionId);
    return { targetConnectionId };
  }

  async release(ownership: RestoreStagingLock): Promise<void> {
    this.lockedTargets.delete(ownership.targetConnectionId);
  }
}

describe('RestoreStagingService', () => {
  let root: string;
  let ownership: FakeOwnership;
  let service: RestoreStagingService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vaultly-restore-staging-test-'));
    ownership = new FakeOwnership();
    service = new RestoreStagingService(ownership, root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function closeDump(staging: { dumpFileHandle: { close(): Promise<void> } | null }): Promise<void> {
    if (!staging.dumpFileHandle) throw new Error('staging dump file was not opened');
    await staging.dumpFileHandle.close();
    staging.dumpFileHandle = null;
  }

  it('creates an exclusive private staging directory and removes it deterministically', async () => {
    const staging = await service.create(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
    );

    const directory = await lstat(staging.directoryPath);
    const dump = await lstat(staging.dumpFilePath);
    expect(directory.isDirectory()).toBe(true);
    expect(dump.isFile()).toBe(true);
    if (process.platform !== 'win32') {
      expect(directory.mode & 0o777).toBe(0o700);
      expect(dump.mode & 0o777).toBe(0o600);
    }
    expect(await readFile(staging.metadataPath, 'utf8')).toBe(
      '00000000-0000-0000-0000-000000000001\n00000000-0000-0000-0000-000000000002\n',
    );

    await service.cleanup(staging);

    await expect(lstat(staging.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes only stale staging whose target is not advisory-owned by a live execution', async () => {
    const stale = await service.create(
      '00000000-0000-0000-0000-000000000011',
      '00000000-0000-0000-0000-000000000012',
    );
    const live = await service.create(
      '00000000-0000-0000-0000-000000000021',
      '00000000-0000-0000-0000-000000000022',
    );
    await closeDump(stale);
    await closeDump(live);
    const old = new Date(Date.now() - 3_600_001);
    await utimes(stale.directoryPath, old, old);
    await utimes(live.directoryPath, old, old);
    ownership.lock('00000000-0000-0000-0000-000000000022');

    await service.sweepOrphans();

    await expect(lstat(stale.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await lstat(live.directoryPath)).isDirectory()).toBe(true);
  });

  it('skips a symlink candidate instead of following it during an orphan sweep', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'vaultly-restore-outside-'));
    const sentinel = join(outside, 'sentinel');
    const candidate = join(root, 'restore-abcdef');
    await writeFile(sentinel, 'preserve');
    await symlink(outside, candidate, 'junction');

    await service.sweepOrphans();

    expect(await readFile(sentinel, 'utf8')).toBe('preserve');
    expect((await lstat(candidate)).isSymbolicLink()).toBe(true);
    await rm(outside, { recursive: true, force: true });
  });

  describe('writeDump', () => {
    it('stages the stream and reports its size and checksum', async () => {
      const staging = await service.create(
        '00000000-0000-0000-0000-000000000031',
        '00000000-0000-0000-0000-000000000032',
      );

      const stats = await service.writeDump(staging, Readable.from([Buffer.from('abc'), Buffer.from('def')]));

      expect(stats).toEqual({
        sha256: createHash('sha256').update('abcdef').digest('hex'),
        bytes: 6,
      });
      expect(await readFile(staging.dumpFilePath, 'utf8')).toBe('abcdef');
      expect(staging.dumpFileHandle).toBeNull();
    });

    it('rejects, closes the dump file and stays settled when the source fails mid-stream', async () => {
      const staging = await service.create(
        '00000000-0000-0000-0000-000000000033',
        '00000000-0000-0000-0000-000000000034',
      );
      const handle = staging.dumpFileHandle;
      const source = new Readable({ read() {} });
      source.push(Buffer.from('partial'));
      setImmediate(() => source.destroy(new Error('connection reset by peer')));

      await expect(service.writeDump(staging, source)).rejects.toThrow('connection reset by peer');

      expect(handle?.fd).toBe(-1);
      expect(staging.dumpFileHandle).toBeNull();
      await service.cleanup(staging);
      await expect(lstat(staging.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }, 2_000);
  });

  describe('writeDump with a signal', () => {
    it('stops a download that is still flowing when the signal fires, and closes the dump file', async () => {
      const staging = await service.create(
        '00000000-0000-0000-0000-000000000035',
        '00000000-0000-0000-0000-000000000036',
      );
      const handle = staging.dumpFileHandle;
      const source = new Readable({ read() {} });
      source.push(Buffer.from('partial'));
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 50);

      await expect(
        service.writeDump(staging, source, { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });

      expect(source.destroyed).toBe(true);
      expect(handle?.fd).toBe(-1);
      expect(staging.dumpFileHandle).toBeNull();
    }, 2_000);

    it('does not touch a signal that never fires', async () => {
      const staging = await service.create(
        '00000000-0000-0000-0000-000000000037',
        '00000000-0000-0000-0000-000000000038',
      );

      const stats = await service.writeDump(staging, Readable.from([Buffer.from('abc')]), {
        signal: new AbortController().signal,
      });

      expect(stats.bytes).toBe(3);
    });
  });

  it('validates disk space successfully when available space exceeds requirements', async () => {
    const result = await service.checkAvailableDiskSpace(1024);
    expect(result.requiredBytes).toBe(1024);
    expect(result.availableBytes).toBeGreaterThan(1024);
  });

  it('throws an error when required space exceeds available disk space', async () => {
    await expect(
      service.checkAvailableDiskSpace(Number.MAX_SAFE_INTEGER - 100),
    ).rejects.toThrow('Espacio insuficiente en disco para staging');
  });
});
