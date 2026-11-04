/**
 * Datos demo de la Fase 5: promociones. Idempotente (no repite si ya hay promociones).
 */
import type { INestApplicationContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { RequestContext } from '../../src/common/context';
import { PromotionsService } from '../../src/sales/promotions.service';

export async function seedFase5(app: INestApplicationContext, owner: PrismaClient, ctx: RequestContext) {
  const companyId = ctx.companyId;
  if ((await owner.promotion.count({ where: { companyId } })) > 0) {
    console.log('Fase 5 ya cargada: se omite.');
    return;
  }
  const category = async (name: string) => (await owner.category.findFirst({ where: { companyId, kind: 'PRODUCT', name } }))?.id;
  const collection = async (name: string) => (await owner.collection.findFirst({ where: { companyId, name } }))?.id;
  const [bodies, enteritos, bosque] = await Promise.all([category('Bodies'), category('Enteritos'), collection('Bosque OI27')]);
  const promotions = app.get(PromotionsService);
  const base = { customerIds: [], priceListIds: [], isActive: true };
  if (bodies) {
    await promotions.create(ctx, {
      ...base,
      name: 'Bodies por 12 o más',
      discountPct: '10',
      minQty: '12',
      scope: 'CATEGORIES',
      targetIds: [bodies],
      validFrom: '2026-10-01',
      validTo: '2026-12-31',
      notes: 'Descuento por volumen para mayoristas: 12 bodies o más en el pedido, de cualquier modelo, talle y color.',
    });
  }
  if (enteritos) {
    await promotions.create(ctx, { ...base, name: 'Enteritos noviembre', discountPct: '12', minQty: '0', scope: 'CATEGORIES', targetIds: [enteritos], validFrom: '2026-11-01', validTo: '2026-11-30', notes: null });
  }
  if (bosque) {
    await promotions.create(ctx, { ...base, name: 'Lanzamiento Bosque OI27', discountPct: '8', minQty: '0', scope: 'COLLECTIONS', targetIds: [bosque], validFrom: '2026-11-15', validTo: '2026-12-15', notes: null });
  }
  console.log('Fase 5: promociones demo.');
}
