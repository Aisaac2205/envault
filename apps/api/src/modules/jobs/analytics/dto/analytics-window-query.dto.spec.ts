import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
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
});
