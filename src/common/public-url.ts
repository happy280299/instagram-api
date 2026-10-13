// '/static/...' -> '<APP_URL>/static/...'; '' hoặc URL ngoài (https://...) giữ nguyên
export function toPublicUrl(path: string): string {
  if (!path || !path.startsWith('/')) return path;
  return `${process.env.APP_URL}${path}`;
}
