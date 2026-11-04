import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { can, RequestContext } from '../common/context';
import { UnitOfWork } from '../common/unit-of-work';
import { Ctx } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';

const SearchQuery = z.object({ q: z.string().trim().min(2).max(100) });

interface Hit {
  type: 'party' | 'product' | 'item' | 'stock_document';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/** Buscador global (Ctrl+K). Solo devuelve tipos que el usuario puede ver. */
@Controller('search')
export class SearchController {
  constructor(private readonly uow: UnitOfWork) {}

  @Get()
  search(@Ctx() ctx: RequestContext, @Query(new ZodPipe(SearchQuery)) { q }: z.infer<typeof SearchQuery>) {
    const like = `%${q}%`;
    return this.uow.run(ctx, async (tx) => {
      const hits: Hit[] = [];
      if (can(ctx, 'parties.view')) {
        const parties = await tx.$queryRaw<{ id: string; legal_name: string; tax_id: string; code: string }[]>`
          SELECT id, legal_name, tax_id, code FROM parties
          WHERE is_active AND (legal_name ILIKE ${like} OR trade_name ILIKE ${like} OR tax_id LIKE ${like} OR code ILIKE ${like})
          ORDER BY similarity(legal_name, ${q}) DESC LIMIT 6`;
        hits.push(...parties.map((p) => ({ type: 'party' as const, id: p.id, title: p.legal_name, subtitle: `${p.code} · ${p.tax_id}`, href: `/terceros/${p.id}` })));
      }
      if (can(ctx, 'catalog.view')) {
        const products = await tx.product.findMany({
          where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] },
          take: 6,
        });
        hits.push(...products.map((p) => ({ type: 'product' as const, id: p.id, title: p.name, subtitle: `Modelo ${p.code}`, href: `/catalogo/${p.id}` })));
      }
      if (can(ctx, 'inventory.view')) {
        const items = await tx.item.findMany({
          where: { OR: [{ sku: { contains: q, mode: 'insensitive' } }, { barcode: q }, { name: { contains: q, mode: 'insensitive' } }] },
          take: 8,
          include: { variant: { select: { productId: true } } },
        });
        hits.push(
          ...items.map((i) => ({
            type: 'item' as const,
            id: i.id,
            title: i.name,
            subtitle: `${i.kind === 'MATERIAL' ? 'Material' : 'Variante'} · ${i.sku}`,
            href: i.kind === 'MATERIAL' ? `/materiales/${i.id}` : `/stock/${i.id}`,
          })),
        );
        const docs = await tx.stockDocument.findMany({ where: { number: { contains: q, mode: 'insensitive' } }, take: 5 });
        hits.push(...docs.map((d) => ({ type: 'stock_document' as const, id: d.id, title: d.number, subtitle: 'Documento de stock', href: `/stock/documentos/${d.id}` })));
      }
      return hits;
    });
  }
}
