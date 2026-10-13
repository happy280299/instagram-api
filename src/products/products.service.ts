import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { ProductQueryDto, ProductSort } from './dto/product-query.dto';

// Luôn kèm thông tin category, chỉ lấy 3 field cần thiết
const productInclude = {
  category: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductInclude;

type ProductWithCategory = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

const ORDER_BY: Record<ProductSort, Prisma.ProductOrderByWithRelationInput[]> =
  {
    newest: [{ createdAt: 'desc' }, { id: 'desc' }],
    price_asc: [{ price: 'asc' }, { id: 'asc' }],
    price_desc: [{ price: 'desc' }, { id: 'asc' }],
    best_selling: [{ sold: 'desc' }, { id: 'asc' }],
  };

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(q: ProductQueryDto) {
    // 1. Build điều kiện WHERE từ các filter có mặt
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(q.search
        ? { name: { contains: q.search, mode: 'insensitive' } }
        : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.minPrice !== undefined || q.maxPrice !== undefined
        ? { price: { gte: q.minPrice, lte: q.maxPrice } }
        : {}),
    };

    // 2. Chạy song song: đếm tổng + lấy 1 trang
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: ORDER_BY[q.sort],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: productInclude,
      }),
    ]);

    // 3. Trả đúng format { data, meta }
    return {
      data: rows.map(toProduct),
      meta: {
        page: q.page,
        limit: q.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.limit)),
      },
    };
  }

  async findBySlug(slug: string) {
    const p = await this.prisma.product.findFirst({
      where: { slug, deletedAt: null },
      include: productInclude,
    });
    if (!p) throw new NotFoundException('Không tìm thấy sản phẩm');
    return toProduct(p);
  }

  async findById(id: number) {
    const p = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: productInclude,
    });
    if (!p) throw new NotFoundException('Không tìm thấy sản phẩm');
    return toProduct(p);
  }
}

function toPublicUrl(path: string): string {
  if (!path || !path.startsWith('/')) return path; // '' hoặc URL ngoài (https://...) giữ nguyên
  return `${process.env.APP_URL}${path}`;
}

// Bỏ các field nội bộ trước khi trả ra ngoài
function toProduct({
  deletedAt: _d,
  updatedAt: _u,
  ...p
}: ProductWithCategory) {
  return { ...p, imageUrl: toPublicUrl(p.imageUrl) };
}
