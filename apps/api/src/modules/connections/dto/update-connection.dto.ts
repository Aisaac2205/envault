import { IntersectionType, OmitType, PartialType } from '@nestjs/mapped-types';
import { IsEnum } from 'class-validator';
import { DbTypeEnum } from '../../../database/enums/db-type.enum';
import { CreateConnectionDto } from './create-connection.dto';

// `dbType` is optional on create (the column default applies) and carries
// @IsOptional() there, which would let `null` through on an update too.
class ConnectionEngineDto {
  @IsEnum(DbTypeEnum)
  dbType!: DbTypeEnum;
}

// Every field may be left out, but none may be set to null: every column of a
// connection is required. `skipNullProperties: false` makes PartialType skip
// validation only for a missing field; its default, @IsOptional(), also skips
// it for null, which then failed in the database with a 500.
export class UpdateConnectionDto extends PartialType(
  IntersectionType(OmitType(CreateConnectionDto, ['dbType'] as const), ConnectionEngineDto),
  { skipNullProperties: false },
) {}
