import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// Phải có ít nhất 1 trong 2: content hoặc mediaUrl (kiểm tra ở ChatService)
export class SendMessageDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(2000, { message: 'Messages can be up to 2,000 characters' })
  content?: string;

  // URL do POST /api/uploads trả về (ảnh hoặc video)
  @IsOptional()
  @IsString()
  mediaUrl?: string;
}
