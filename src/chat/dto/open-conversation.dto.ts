import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class OpenConversationDto {
  // username của người muốn nhắn (chấp nhận cả '@username')
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.trim().replace(/^@+/, '').toLowerCase()
      : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  username!: string;
}
