// Domain FE được phép gọi API và kết nối socket (dùng chung cho REST + Socket.IO)
export const CORS_ORIGINS = [
  process.env.APP_URL ?? 'http://localhost:3001',
  'http://localhost:5173',
];
