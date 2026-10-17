// Tách #hashtag và @username trong caption / comment.
// Quy tắc hashtag phải khớp với migration hashtags_mentions (regex [[:alnum:]_]{1,50} bên Postgres)
const HASHTAG_RE = /#([\p{L}\p{N}_]{1,50})/gu;
const MENTION_RE = /@([a-z0-9._]{1,30})/gi;

export const MAX_HASHTAGS = 30; // giới hạn của Instagram
export const MAX_MENTIONS = 20;

// '#ĐàLạt #dalat #ĐÀLẠT' -> ['đàlạt', 'dalat'] (chữ thường, NFC, không trùng)
export function extractHashtags(text: string): string[] {
  return unique(
    [...text.matchAll(HASHTAG_RE)].map((m) =>
      m[1].toLowerCase().normalize('NFC'),
    ),
  );
}

// 'hi @Maya_Chen và @happy_4.' -> ['maya_chen', 'happy_4']
export function extractMentions(text: string): string[] {
  return unique(
    [...text.matchAll(MENTION_RE)].map((m) =>
      m[1].toLowerCase().replace(/\.+$/, ''),
    ),
  ).filter(Boolean);
}

// Từ khoá người dùng gõ ở ô tìm hashtag / URL trang hashtag: bỏ '#', chữ thường, NFC
export function normalizeHashtag(input: string): string {
  return input.trim().replace(/^#+/, '').toLowerCase().normalize('NFC');
}

function unique(items: string[]) {
  return [...new Set(items)];
}
