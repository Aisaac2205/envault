import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  ValidateIf,
} from 'class-validator';
import { CronFrequency } from '../../../database/enums/cron-frequency.enum';
import { IsScheduleInput, ScheduleInputDto } from './schedule.dto';

// The legacy pair is validated only while no schedule is sent. When both are
// sent, the service answers 400: it is the one place that resolves what is
// stored from either of them.
const unlessScheduleIsSent = ValidateIf((dto: CreateCronjobDto) => dto.schedule === undefined);

export class CreateCronjobDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty()
  connectionId!: string;

  // Structured schedule; the API derives cronExpression and frequency from it.
  @IsScheduleInput()
  schedule?: ScheduleInputDto;

  @unlessScheduleIsSent
  @IsString()
  @IsNotEmpty()
  cronExpression?: string;

  @unlessScheduleIsSent
  @IsEnum(CronFrequency)
  frequency?: CronFrequency;

  // --- Retention policy (optional) ---
  @IsOptional()
  @IsBoolean()
  retentionEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  retentionKeepLast?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  retentionMaxAgeDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  retentionMaxSizeMb?: number;
}
