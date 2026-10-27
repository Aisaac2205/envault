import { IntersectionType, OmitType, PartialType } from '@nestjs/mapped-types';
import { IsBoolean } from 'class-validator';
import { CreateCronjobDto } from './create-cronjob.dto';

// Switches an update may change. `retentionEnabled` is optional on create and
// carries @IsOptional() there, which would let `null` through on an update too.
class CronjobSwitchesDto {
  @IsBoolean()
  isActive!: boolean;

  @IsBoolean()
  retentionEnabled!: boolean;
}

// Every field may be left out. `skipNullProperties: false` makes PartialType
// skip validation only for a missing field; its default, @IsOptional(), also
// skips it for null, which then failed in the database with a 500. The
// retention limits keep the @IsOptional() of the create DTO on purpose: they
// are nullable columns, and null is how a limit is removed. `schedule` skips
// validation only when missing as well (see IsScheduleInput), so a null
// schedule is a 400.
export class UpdateCronjobDto extends PartialType(
  IntersectionType(OmitType(CreateCronjobDto, ['retentionEnabled'] as const), CronjobSwitchesDto),
  { skipNullProperties: false },
) {}
