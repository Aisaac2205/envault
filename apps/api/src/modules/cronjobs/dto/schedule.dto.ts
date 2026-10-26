import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  EVERY_HOURS_VALUES,
  EveryHours,
  MAX_DAY_OF_MONTH,
  SCHEDULE_KINDS,
  ScheduleKind,
  TIME_PATTERN,
} from '../schedule';

const TIME_MESSAGE = 'time must be a 24-hour time written as HH:mm';

// Target class-transformer falls back to when `kind` names no variant. It only
// knows `kind`, so an unknown kind, or the fields of a variant next to one,
// is answered with 400. Each variant extends it, which keeps `kind` validated.
export class ScheduleDto {
  @IsIn(SCHEDULE_KINDS)
  kind!: ScheduleKind;
}

export class EveryHoursScheduleDto extends ScheduleDto {
  declare kind: 'every_hours';

  @IsIn(EVERY_HOURS_VALUES)
  everyHours!: EveryHours;
}

export class DailyScheduleDto extends ScheduleDto {
  declare kind: 'daily';

  @IsString()
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  time!: string;
}

export class WeeklyScheduleDto extends ScheduleDto {
  declare kind: 'weekly';

  @IsString()
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  time!: string;

  // 0 = Sunday .. 6 = Saturday.
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek!: number[];
}

export class MonthlyScheduleDto extends ScheduleDto {
  declare kind: 'monthly';

  @IsString()
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  time!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_DAY_OF_MONTH)
  dayOfMonth!: number;
}

export type ScheduleInputDto =
  | EveryHoursScheduleDto
  | DailyScheduleDto
  | WeeklyScheduleDto
  | MonthlyScheduleDto;

// Validates a property as a ScheduleInputDto. A property that is left out
// (undefined) is not validated, but null is: it is never a schedule.
export const IsScheduleInput = () =>
  applyDecorators(
    ValidateIf((_dto, value) => value !== undefined),
    IsObject(),
    ValidateNested(),
    Type(() => ScheduleDto, {
      discriminator: {
        property: 'kind',
        subTypes: [
          { value: EveryHoursScheduleDto, name: 'every_hours' },
          { value: DailyScheduleDto, name: 'daily' },
          { value: WeeklyScheduleDto, name: 'weekly' },
          { value: MonthlyScheduleDto, name: 'monthly' },
        ],
      },
      keepDiscriminatorProperty: true,
    }),
  );
