/// <reference types="jest" />
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validationPipeOptions } from '../../../common/pipes/validation-pipe.options';
import { CreateRestoreDto } from './create-restore.dto';

// A restore needs a source: either the id of a completed backup or the key of a
// dump in object storage. These cases run through the same pipe options as the
// application, so they describe what POST /api/restores accepts and rejects.
describe('CreateRestoreDto source validation', () => {
  const pipe = new ValidationPipe(validationPipeOptions);
  const targetConnectionId = '00000000-0000-4000-8000-000000000001';
  const backupId = '00000000-0000-4000-8000-000000000002';
  const r2Key = 'billing/manual/2026-01-01.dump';

  const validate = (source: Record<string, unknown>) =>
    pipe.transform(
      { targetConnectionId, isDryRun: true, ...source },
      { type: 'body', metatype: CreateRestoreDto },
    ) as Promise<CreateRestoreDto>;

  describe('accepts', () => {
    it('a backup id alone', async () => {
      await expect(validate({ sourceBackupId: backupId })).resolves.toMatchObject({
        sourceBackupId: backupId,
      });
    });

    it('an object key alone', async () => {
      await expect(validate({ r2Key })).resolves.toMatchObject({ r2Key });
    });

    it('both, keeping both values (the service gives the key priority)', async () => {
      await expect(validate({ sourceBackupId: backupId, r2Key })).resolves.toMatchObject({
        sourceBackupId: backupId,
        r2Key,
      });
    });

    it('a backup id next to an empty object key', async () => {
      await expect(validate({ sourceBackupId: backupId, r2Key: '' })).resolves.toMatchObject({
        sourceBackupId: backupId,
      });
    });
  });

  describe('rejects with 400', () => {
    const rejected: Array<[string, Record<string, unknown>]> = [
      ['neither field', {}],
      ['an undefined backup id and an undefined key', { sourceBackupId: undefined, r2Key: undefined }],
      ['null in both fields', { sourceBackupId: null, r2Key: null }],
      ['an empty backup id alone', { sourceBackupId: '' }],
      ['an empty object key alone', { r2Key: '' }],
      ['both fields empty', { sourceBackupId: '', r2Key: '' }],
      ['a malformed backup id alone', { sourceBackupId: 'not-a-uuid' }],
      ['a malformed backup id next to an empty key', { sourceBackupId: 'not-a-uuid', r2Key: '' }],
    ];

    it.each(rejected)('%s', async (_title, source) => {
      await expect(validate(source)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('names both source fields when neither is given', async () => {
      const error = (await validate({}).catch((e: unknown) => e)) as BadRequestException;
      const { message } = error.getResponse() as { message: string[] };

      expect(message.join(' ')).toMatch(/sourceBackupId/);
      expect(message.join(' ')).toMatch(/r2Key/);
    });
  });
});
