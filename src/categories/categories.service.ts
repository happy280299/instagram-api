import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const rows = await this.prisma.category.findMany({
      orderBy: { id: 'asc' },
      include: {
        // Đếm số sản phẩm CHƯA bị xoá trong mỗi danh mục
        _count: { select: { products: { where: { deletedAt: null } } } },
      },
    });
    // Đổi _count.products → productCount cho khớp API contract
    return rows.map(({ _count, ...c }) => ({
      ...c,
      productCount: _count.products,
    }));
  }
}
