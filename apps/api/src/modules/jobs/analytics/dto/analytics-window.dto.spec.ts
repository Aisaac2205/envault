import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { validationPipeOptions } from '../../../../common/pipes/validation-pipe.options';
import { AnalyticsWindowDto } from './analytics-window.dto';
import { AnalyticsWindowQueryDto } from './analytics-window-query.dto';

describe('AnalyticsWindowDto', () => {
  it('passes validation when window is omitted', async () => {
    const dto = plainToInstance(AnalyticsWindowDto, {});

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.window).toBeUndefined();
  });

  it.each([7, 30, 90])('passes validation with window=%i', async (window) => {
    const dto = plainToInstance(AnalyticsWindowDto, { window: String(window) });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.window).toBe(window);
  });

  it.each(['0', '8', '15', '-7', '7.5', 'abc'])('fails validation with window=%s', async (window) => {
    const errors = await validate(plainToInstance(AnalyticsWindowDto, { window }));

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('window');
  });

  it('is the base of the daily query DTO, which keeps the same window rules', async () => {
    expect(Object.getPrototypeOf(AnalyticsWindowQueryDto)).toBe(AnalyticsWindowDto);

    const errors = await validate(plainToInstance(AnalyticsWindowQueryDto, { window: '15' }));

    expect(errors[0].property).toBe('window');
  });

  describe('through the global ValidationPipe', () => {
    const pipe = new ValidationPipe(validationPipeOptions);
    const metadata: ArgumentMetadata = { type: 'query', metatype: AnalyticsWindowDto };

    it('accepts a valid window and converts it to a number', async () => {
      expect(await pipe.transform({ window: '30' }, metadata)).toEqual({ window: 30 });
    });

    it('accepts no query at all', async () => {
      expect(await pipe.transform({}, metadata)).toEqual({});
    });

    it('rejects an unsupported window with 400', async () => {
      await expect(pipe.transform({ window: '8' }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a connectionId, which this endpoint does not take (unknown query keys are forbidden)', async () => {
      await expect(
        pipe.transform({ window: '7', connectionId: '6c1f2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b' }, metadata),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
