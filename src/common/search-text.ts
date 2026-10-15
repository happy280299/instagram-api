// 'Nguyễn  Văn Đức' -> 'nguyen van duc': chữ thường, bỏ dấu, gộp khoảng trắng.
// Dùng cho cột User.nameSearch và từ khoá tìm kiếm để gõ không dấu vẫn ra kết quả
export function toSearchText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
