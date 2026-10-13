import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  name!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  // Không gửi thì tự sinh từ email
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsOptional()
  @Matches(/^[a-z0-9._]+$/, {
    message: 'username chỉ gồm chữ thường, số, dấu chấm và gạch dưới',
  })
  @MaxLength(30)
  username?: string;

  @IsString()
  @MinLength(6)
  password!: string;
}
