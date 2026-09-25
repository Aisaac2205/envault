import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { chmod, lstat, mkdtemp, open, readFile, readdir, rm, statfs, writeFile } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { Readable, Transform } from 'stream';

export const RESTORE_STAGING_OWNERSHIP = 'RESTORE_STAGING_OWNERSHIP';

export interface RestoreStagingLock {
  targetConnectionId: string;
}

export interface RestoreStagingOwnership {
  tryAcquire(targetConnectionId: string): Promise<RestoreStagingLock | null>;
  release(lock: RestoreStagingLock): Promise<void>;
}

export interface RestoreStaging {
  directoryPath: string;
  dumpFilePath: string;
  metadataPath: string;
  dumpFileHandle: FileHandle | null;
}

export interface StagedDumpStats {
  sha256: string;
  bytes: number;
}

const STAGING_DIRECTORY_PREFIX = 'restore-';
const DUMP_FILE_NAME = 'dump.bin';
const METADATA_FILE_NAME = 'metadata.txt';
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const ORPHAN_MAX_AGE_MS = 60 * 60_000;

@Injectable()
export class RestoreStagingService {
  private readonly logger = new Logger(RestoreStagingService.name);
  private readonly root: string;

  constructor(
    @Inject(RESTORE_STAGING_OWNERSHIP)
    private readonly ownership: RestoreStagingOwnership,
    @Optional() root?: string,
  ) {
    this.root = root ?? tmpdir();
  }

  async checkAvailableDiskSpace(requiredBytes: number): Promise<{ availableBytes: number; requiredBytes: number }> {
    const stats = await statfs(this.root);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    const safetyBuffer = Math.max(50 * 1024 * 1024, Math.floor(requiredBytes * 0.2));
    const totalNeeded = requiredBytes + safetyBuffer;

    if (availableBytes < totalNeeded) {
      const availableMb = (availableBytes / (1024 * 1024)).toFixed(2);
      const neededMb = (totalNeeded / (1024 * 1024)).toFixed(2);
      throw new Error(
        `Espacio insuficiente en disco para staging. Disponible: ${availableMb} MB, Requerido: ${neededMb} MB`,
      );
    }

    return { availableBytes, requiredBytes };
  }

  async create(jobId: string, targetConnectionId: string): Promise<RestoreStaging> {
    const directoryPath = await mkdtemp(join(this.root, STAGING_DIRECTORY_PREFIX));
    await chmod(directoryPath, DIRECTORY_MODE);

    const dumpFilePath = join(directoryPath, DUMP_FILE_NAME);
    const metadataPath = join(directoryPath, METADATA_FILE_NAME);

    const dumpFileHandle = await open(dumpFilePath, 'wx', FILE_MODE);
    await dumpFileHandle.chmod(FILE_MODE);

    await writeFile(metadataPath, `${jobId}\n${targetConnectionId}\n`, { mode: FILE_MODE });

    return { directoryPath, dumpFilePath, metadataPath, dumpFileHandle };
  }

  async writeDump(
    staging: RestoreStaging,
    source: Readable,
  ): Promise<StagedDumpStats> {
    const handle = staging.dumpFileHandle;
    if (!handle) {
      throw new Error(`Restore staging dump file is not open: ${staging.dumpFilePath}`);
    }

    const hash = createHash('sha256');
    let totalBytes = 0;
    const hasher = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        totalBytes += chunk.length;
        hash.update(chunk);
        cb(null, chunk);
      },
    });

    source.pipe(hasher);

    try {
      await writeFile(handle, hasher);
      return {
        sha256: hash.digest('hex'),
        bytes: totalBytes,
      };
    } finally {
      await handle.close();
      staging.dumpFileHandle = null;
    }
  }


  async cleanup(staging: RestoreStaging): Promise<void> {
    if (staging.dumpFileHandle) {
      await staging.dumpFileHandle.close();
      staging.dumpFileHandle = null;
    }
    await rm(staging.directoryPath, { recursive: true, force: true });
  }

  async sweepOrphans(): Promise<void> {
    let candidateNames: string[];
    try {
      candidateNames = await readdir(this.root);
    } catch (error) {
      this.logger.warn(
        `Failed to read restore staging root "${this.root}": ${(error as Error).message}`,
      );
      return;
    }

    for (const name of candidateNames) {
      if (!name.startsWith(STAGING_DIRECTORY_PREFIX)) continue;
      await this.sweepCandidate(join(this.root, name));
    }
  }

  private async sweepCandidate(candidatePath: string): Promise<void> {
    const stats = await lstat(candidatePath).catch(() => null);
    if (!stats || !stats.isDirectory()) return;
    if (Date.now() - stats.mtimeMs < ORPHAN_MAX_AGE_MS) return;

    const targetConnectionId = await this.readTargetConnectionId(candidatePath);
    if (!targetConnectionId) return;

    const lock = await this.ownership.tryAcquire(targetConnectionId);
    if (!lock) return;

    try {
      await rm(candidatePath, { recursive: true, force: true });
    } finally {
      await this.ownership.release(lock);
    }
  }

  private async readTargetConnectionId(candidatePath: string): Promise<string | null> {
    try {
      const metadata = await readFile(join(candidatePath, METADATA_FILE_NAME), 'utf8');
      const targetConnectionId = metadata.split('\n')[1];
      return targetConnectionId ? targetConnectionId.trim() || null : null;
    } catch {
      return null;
    }
  }
}
