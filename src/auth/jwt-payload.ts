import type { User } from '../generated/prisma/client';

export interface JwtPayload {
  sub: number; // userId
  role: User['role']; // 'USER' | 'ADMIN'
}
