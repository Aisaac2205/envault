import { IsString, IsNotEmpty, MaxLength, IsEnum, IsInt, Min, Max, IsOptional } from 'class-validator';
import { Environment } from '../../../database/enums/environment.enum';
import { DbTypeEnum } from '../../../database/enums/db-type.enum';

export class CreateConnectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsEnum(Environment)
  environment!: Environment;

  // Left unset when omitted: the column default of ConnectionEntity (postgres)
  // applies. Do not give it an initializer here, because PartialType copies
  // initializers to UpdateConnectionDto and every update would then reset the
  // engine to postgres.
  @IsOptional()
  @IsEnum(DbTypeEnum)
  dbType?: DbTypeEnum;

  @IsString()
  @IsNotEmpty()
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsString()
  @IsNotEmpty()
  database!: string;

  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
