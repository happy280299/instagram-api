// Domain FE được phép gọi API và kết nối socket (dùng chung cho REST + Socket.IO).
// Production: FRONTEND_URLS=https://mysite.netlify.app,https://*--mysite.netlify.app
// ('*' khớp 1 đoạn bất kỳ, vd. link deploy preview của Netlify: deploy-preview-12--mysite)
// Không đặt biến này thì dùng các domain FE khi chạy local
const DEV_ORIGINS = ['http://localhost:3001', 'http://localhost:5173'];

export const CORS_ORIGINS: (string | RegExp)[] = (
  process.env.FRONTEND_URLS?.split(',') ?? DEV_ORIGINS
)
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean)
  .map((origin) =>
    origin.includes('*')
      ? new RegExp(
          '^' +
            origin
              .split('*')
              .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
              .join('[^/]*') +
            '$',
        )
      : origin,
  );
