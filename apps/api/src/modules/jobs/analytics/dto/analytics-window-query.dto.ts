import { IsIn, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ANALYTICS_WINDOWS, AnalyticsWindow } from '../jobs-analytics.types';

export class AnalyticsWindowQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(ANALYTICS_WINDOWS)
  window?: AnalyticsWindow;
}
