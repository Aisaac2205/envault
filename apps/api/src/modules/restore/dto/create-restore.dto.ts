import {
  IsUUID,
  IsBoolean,
  IsNotEmpty,
  IsString,
  ValidateIf,
} from 'class-validator';

// The source of a restore is either a completed backup (`sourceBackupId`) or a
// dump key in object storage (`r2Key`). One of them is required: each field is
// validated only while the other one is missing, so a request that names
// neither is rejected. Do not add @IsOptional() to either field, it would skip
// the validation exactly in that case. When both are given, `r2Key` wins.
export class CreateRestoreDto {
  @IsUUID()
  @ValidateIf((o) => !o.r2Key)
  sourceBackupId?: string;

  @IsUUID()
  targetConnectionId!: string;

  @IsBoolean()
  isDryRun!: boolean;

  @IsString()
  @IsNotEmpty()
  @ValidateIf((o) => !o.sourceBackupId)
  r2Key?: string;
}
