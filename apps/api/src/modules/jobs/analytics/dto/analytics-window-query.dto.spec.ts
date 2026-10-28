import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { validationPipeOptions } from '../../../../common/pipes/validation-pipe.options';
import { AnalyticsWindowQueryDto } from './analytics-window-query.dto';

describe('AnalyticsWindowQueryDto', () => {
  it('passes validation when window is omitted', async () => {
    const dto = plainToInstance(AnalyticsWindowQueryDto, {});
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.window).toBeUndefined();
  });

  it.each([7, 30, 90])('passes validation with window=%i', async (window) => {
    const dto = plainToInstance(AnalyticsWindowQueryDto, { window: String(window) });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.window).toBe(window);
  });

  it('fails validation when window is not one of 7/30/90', async () => {
    const dto = plainToInstance(AnalyticsWindowQueryDto, { window: '15' });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('window');
  });

  it('fails validation when window is not a number', async () => {
    const dto = plainToInstance(AnalyticsWindowQueryDto, { window: 'abc' });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('window');
  });

  it('fails validation when window is zero', async () => {
    const dto = plainToInstance(AnalyticsWindowQueryDto, { window: '0' });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('window');
  });

  describe('connectionId', () => {
    const VALID_ID = '6c1f2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

    it('passes validation when connectionId is omitted', async () => {
      const dto = plainToInstance(AnalyticsWindowQueryDto, { window: '7' });
      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
      expect(dto.connectionId).toBeUndefined();
    });

    it('passes validation with a UUID connectionId', async () => {
      const dto = plainToInstance(AnalyticsWindowQueryDto, { connectionId: VALID_ID });
      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
      expect(dto.connectionId).toBe(VALID_ID);
    });

    it.each(['not-a-uuid', '123', '6c1f2b3a4d5e4f608a7b9c0d1e2f3a4b'])(
      'fails validation when connectionId is %s',
      async (connectionId) => {
        const dto = plainToInstance(AnalyticsWindowQueryDto, { connectionId });
        const errors = await validate(dto);

        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].property).toBe('connectionId');
      },
    );

    // The global pipe forbids unknown query keys, so this also proves the
    // field is declared on the DTO and not rejected as non-whitelisted.
    describe('through the global ValidationPipe', () => {
      const pipe = new ValidationPipe(validationPipeOptions);
      const metadata: ArgumentMetadata = { type: 'query', metatype: AnalyticsWindowQueryDto };

      it('accepts a UUID connectionId alongside window', async () => {
        const dto = await pipe.transform({ window: '90', connectionId: VALID_ID }, metadata);

        expect(dto).toEqual({ window: 90, connectionId: VALID_ID });
      });

      it('rejects a malformed connectionId with 400', async () => {
        await expect(pipe.transform({ connectionId: 'not-a-uuid' }, metadata)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      });
    });
  });
});
