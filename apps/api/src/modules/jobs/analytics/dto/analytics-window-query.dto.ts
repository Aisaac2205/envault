import { IsOptional, IsUUID } from 'class-validator';
import { AnalyticsWindowDto } from './analytics-window.dto';

/** The daily series: the shared window plus an optional connection to scope it to. */
export class AnalyticsWindowQueryDto extends AnalyticsWindowDto {
  @IsOptional()
  @IsUUID()
  connectionId?: string;
}
