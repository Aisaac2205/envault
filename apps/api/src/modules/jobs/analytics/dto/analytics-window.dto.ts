import { IsIn, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ANALYTICS_WINDOWS, AnalyticsWindow } from '../jobs-analytics.types';

/** The `?window=` query shared by every analytics endpoint that covers a range of days. */
export class AnalyticsWindowDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(ANALYTICS_WINDOWS)
  window?: AnalyticsWindow;
}
