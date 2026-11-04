/**
 * Datos demo de la Fase 2 (producción, talleres y compras) para la empresa ficticia.
 * Se ejecuta una sola vez: si ya hay etapas de producción, se omite.
 */
import type { INestApplicationContext } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { RequestContext } from '../../src/common/context';
import { ProductionConfigService } from '../../src/production/production-config.service';
import { TechSheetsService } from '../../src/production/techsheets.service';
import { ProductionService } from '../../src/production/production.service';
import { PurchasingService } from '../../src/purchasing/purchasing.service';
import { SettlementsService } from '../../src/production/settlements.service';
import { businessDate } from '../../src/common/dates';

export async function seedFase2(app: INestApplicationContext, owner: PrismaClient, ctx: RequestContext) {
  const companyId = ctx.companyId;
  if ((await owner.productionStage.count({ where: { companyId } })) > 0) {
    console.log('Fase 2 ya cargada: se omite.');
    return;
  }
  const config = app.get(ProductionConfigService);
  const sheets = app.get(TechSheetsService);
  const production = app.get(ProductionService);
  const purchasing = app.get(PurchasingService);
  const settlements = app.get(SettlementsService);

  const stage: Record<string, string> = {};
  for (const [code, name, sortOrder, isExternal] of [
    ['CORTE', 'Corte', 1, false],
    ['CONF', 'Confección', 2, true],
    ['TERM', 'Terminación', 3, false],
    ['QC', 'Control de calidad', 4, false],
    ['PLANCH', 'Planchado', 5, false],
    ['EMPAQ', 'Etiquetado y empaquetado', 6, false],
  ] as const) {
    stage[code] = (await config.upsertStage(ctx, { code, name, sortOrder, isExternal })).id;
  }
  for (const name of ['Costura falla', 'Mancha', 'Medida incorrecta', 'Tela con defecto', 'Broche mal colocado']) {
    await config.createDefectReason(ctx, { name });
  }

  const byCode = async (code: string) => owner.product.findFirstOrThrow({ where: { companyId, code } });
  const item = async (sku: string) => (await owner.item.findFirstOrThrow({ where: { companyId, sku } })).id;
  const color = async (code: string) => (await owner.color.findFirstOrThrow({ where: { companyId, code } })).id;
  const party = async (legalName: string) => (await owner.party.findFirstOrThrow({ where: { companyId, legalName } })).id;
  const wh = async (code: string) => (await owner.warehouse.findFirstOrThrow({ where: { companyId, code } })).id;

  const tela: Record<string, string> = {
    BLA: await item('TELA-INTERLOCK-BLA'),
    ROS: await item('TELA-INTERLOCK-ROS'),
    CEL: await item('TELA-INTERLOCK-CEL'),
    BEI: await item('TELA-INTERLOCK-BEI'),
    GRI: await item('TELA-FRISA-GRI'),
  };
  const colorMap = async (codes: string[]) => Object.fromEntries(await Promise.all(codes.map(async (c) => [await color(c), tela[c]!])));
  const broche = await item('AVIO-BROCHE-PRESION');
  const etiq = await item('AVIO-ETIQ-MARCA');
  const talle = await item('AVIO-ETIQ-TALLE');
  const bolsa = await item('PACK-BOLSA-CHICA');
  const rib = await item('TELA-RIB-BLA');
  const elastico = await item('AVIO-ELASTICO-15');
  const hilo = await item('HILO-POLI-BLA');

  const bebe = await owner.sizeScale.findFirstOrThrow({ where: { companyId, name: 'Bebé' }, include: { sizes: true } });
  const size = (code: string) => bebe.sizes.find((s) => s.code === code)!.id;
  const progressive = (base: number[]) => Object.fromEntries(['RN', '0-3', '3-6', '6-9', '9-12'].map((c, i) => [size(c), String(base[i])]));
  const route = [stage.CORTE!, stage.CONF!, stage.TERM!, stage.QC!, stage.EMPAQ!];

  const common = [
    { materialItemId: etiq, qtyPerUnit: '1', wastePct: '2' },
    { materialItemId: talle, qtyPerUnit: '1', wastePct: '2' },
    { materialItemId: bolsa, qtyPerUnit: '1', wastePct: '0' },
    { materialItemId: hilo, qtyPerUnit: '0.02', wastePct: '0' },
  ];
  const defs = [
    { code: 'BODY-ML', colors: ['BLA', 'ROS', 'CEL', 'BEI'], tela: [0.42, 0.46, 0.5, 0.55, 0.6], broches: '3', extra: [{ materialItemId: rib, qtyPerUnit: '0.05', wastePct: '5' }] },
    { code: 'BODY-MC', colors: ['BLA', 'ROS', 'CEL'], tela: [0.35, 0.38, 0.42, 0.46, 0.5], broches: '3', extra: [] },
    { code: 'PANT-RIB', colors: ['BLA', 'ROS', 'CEL', 'BEI', 'GRI'], tela: [0.3, 0.33, 0.36, 0.4, 0.44], broches: null, extra: [{ materialItemId: elastico, qtyPerUnit: '0.45', wastePct: '3' }] },
    { code: 'ENT-OSITO', colors: ['BEI', 'GRI', 'CEL'], tela: [0.7, 0.78, 0.86, 0.95, 1.05], broches: '7', extra: [] },
  ];
  for (const d of defs) {
    const p = await byCode(d.code);
    await sheets.saveDraft(ctx, p.id, {
      stageIds: route,
      instructions: 'Ficha demo. Consumos de tela por talle con 8 % de merma de tizada.',
      materials: [
        { byGarmentColor: true, colorMap: await colorMap(d.colors), materialItemId: null, qtyPerUnit: String(d.tela[2]), sizeQty: progressive(d.tela), wastePct: '8', notes: 'Tela del color de la prenda' },
        ...(d.broches ? [{ materialItemId: broche, qtyPerUnit: d.broches, wastePct: '2', byGarmentColor: false, colorMap: {}, sizeQty: {}, notes: null }] : []),
        ...[...d.extra, ...common].map((m) => ({ ...m, byGarmentColor: false, colorMap: {}, sizeQty: {}, notes: null })),
      ],
    });
    await sheets.activate(ctx, p.id);
  }

  // Tarifas por prenda terminada (confirmado por el cliente: el taller cotiza por prenda, un precio por modelo).
  const rosa = await party('Taller de Costura Rosa Benítez');
  const ramirez = await party('Taller Confecciones Ramírez');
  const rates: [string, string, string][] = [
    [rosa, 'BODY-ML', '1800'], [rosa, 'BODY-MC', '1500'], [rosa, 'ENT-OSITO', '3200'],
    [ramirez, 'BODY-ML', '1750'], [ramirez, 'PANT-RIB', '1400'], [ramirez, 'ENT-OSITO', '3350'],
  ];
  for (const [w, code, price] of rates) {
    await config.createRate(ctx, { workshopId: w, productId: (await byCode(code)).id, price, validFrom: new Date('2026-09-01') });
  }

  const MP = await wh('MP');
  const PT = await wh('PT');
  const CUAR = await wh('CUAR');
  const lines = async (code: string, qty: Record<string, number>) => {
    const p = await byCode(code);
    const variants = await owner.productVariant.findMany({ where: { productId: p.id }, include: { item: true } });
    return Object.entries(qty).map(([suffix, q]) => ({ variantItemId: variants.find((v) => v.item.sku === `${code}-${suffix}`)!.itemId, qty: String(q) }));
  };
  const today = businessDate();
  const days = (n: number) => businessDate(n);
  const base = { materialsWarehouseId: MP, outputWarehouseId: PT, secondsWarehouseId: CUAR, priority: 2, plannedStart: null, responsibleUserId: null, notes: null };

  // OP 1: Body ML en el taller Rosa (en curso, con recepción parcial).
  const op1 = await production.create(ctx, {
    ...base, productId: (await byCode('BODY-ML')).id, dueDate: days(7),
    lines: await lines('BODY-ML', { 'ROS-0-3': 30, 'ROS-3-6': 30, 'BLA-0-3': 20, 'BLA-3-6': 20 }),
  });
  await production.release(ctx, op1.id);
  const op1d = await production.detail(ctx, op1.id);
  const d1 = await production.dispatch(ctx, op1.id, {
    workshopId: rosa, expectedAt: days(5), notes: 'Piezas cortadas en fábrica; viajan con avíos',
    garments: op1d.lines.map((l) => ({ variantItemId: l.variantItemId, qty: l.plannedQty.toString() })),
    materials: op1d.requirements.map((r) => ({ materialItemId: r.materialItemId, qty: r.requiredQty.toString(), lotCode: null })),
  });
  await production.report(ctx, op1.id, { stageId: stage.CORTE!, qtyGood: '100', qtyDefect: '0', finishStage: true, notes: null, defectReasonId: null });
  const defect = await owner.defectReason.findFirstOrThrow({ where: { companyId, name: 'Costura falla' } });
  const out1 = await production.output(ctx, op1.id, {
    dispatchId: d1.id, notes: 'Primera entrega del taller',
    lines: (await lines('BODY-ML', { 'ROS-0-3': 30, 'ROS-3-6': 28 })).map((l, i) => ({
      variantItemId: l.variantItemId, approvedQty: i === 0 ? '29' : '27', secondQty: '1', scrapQty: i === 0 ? '0' : '0', defectReasonId: defect.id,
    })),
  });
  await settlements.create(ctx, {
    workshopId: rosa, outputIds: [out1.id], issueDate: today, dueDate: days(15), notes: 'Primera entrega OP Body ML',
    deductions: [], invoice: { docType: 'FC', pointOfSale: 2, number: 145, vatRate: '0' },
  });

  // OP 2: Pantalón rib en borrador (planificación).
  await production.create(ctx, {
    ...base, productId: (await byCode('PANT-RIB')).id, dueDate: days(20),
    lines: await lines('PANT-RIB', { 'GRI-0-3': 15, 'GRI-3-6': 15, 'BEI-3-6': 10 }),
  });

  // OP 3: Body MC producido en planta, cerrado con costo real.
  const op3 = await production.create(ctx, {
    ...base, productId: (await byCode('BODY-MC')).id, dueDate: days(-3), lines: await lines('BODY-MC', { 'BLA-RN': 12, 'CEL-RN': 12 }),
  });
  await production.release(ctx, op3.id);
  const op3d = await production.detail(ctx, op3.id);
  await production.issueMaterials(ctx, op3.id, { workshopId: null, notes: null, lines: op3d.requirements.map((r) => ({ materialItemId: r.materialItemId, qty: r.requiredQty.toString(), lotCode: null })) });
  for (const s of op3d.stages) await production.report(ctx, op3.id, { stageId: s.stageId, qtyGood: '24', qtyDefect: '0', finishStage: true, notes: null, defectReasonId: null });
  await production.output(ctx, op3.id, {
    dispatchId: null, notes: null,
    lines: (await lines('BODY-MC', { 'BLA-RN': 12, 'CEL-RN': 12 })).map((l, i) => ({ variantItemId: l.variantItemId, approvedQty: i ? '12' : '11', secondQty: '0', scrapQty: i ? '0' : '1', defectReasonId: null })),
  });
  await production.close(ctx, op3.id);

  // OP 4: Enterito liberado con faltante de interlock celeste → solicitud de compra → OC aprobada pendiente de recibir.
  const op4 = await production.create(ctx, {
    ...base, productId: (await byCode('ENT-OSITO')).id, priority: 1, dueDate: days(-1),
    lines: await lines('ENT-OSITO', { 'CEL-3-6': 60, 'CEL-6-9': 60, 'BEI-3-6': 30 }),
  });
  await production.release(ctx, op4.id);
  const req = await production.requestShortages(ctx, op4.id);
  const textil = await party('Textil Algodonera del Oeste SA');
  const telaCel = req.lines.find((l) => l.itemId === tela.CEL);
  await purchasing.createOrder(ctx, {
    supplierId: textil, warehouseId: MP, expectedAt: days(3), notes: `Para ${op4.number ?? 'OP'}`,
    requestLineIds: telaCel ? [telaCel.id] : [],
    lines: [{ itemId: tela.CEL, qty: '200', unitPrice: '4950', vatRate: '21' }],
  });

  // Compra de avíos recibida y facturada (genera deuda con el proveedor).
  const avios = await party('Avíos y Botones Once SRL');
  const po = await purchasing.createOrder(ctx, {
    supplierId: avios, warehouseId: MP, expectedAt: days(-5), notes: null,
    lines: [{ itemId: broche, qty: '5000', unitPrice: '19', vatRate: '21' }, { itemId: etiq, qty: '2000', unitPrice: '41', vatRate: '21' }],
  });
  const rec = await purchasing.createReceipt(ctx, {
    supplierId: avios, warehouseId: MP, purchaseOrderId: po.id, supplierDeliveryNote: '0004-00012877', notes: null,
    lines: po.lines.map((l) => ({ poLineId: l.id, itemId: l.itemId, qty: l.qty.toString(), unitCost: null, lotCode: null })),
  });
  await purchasing.createInvoice(ctx, {
    supplierId: avios, docType: 'FA', pointOfSale: 4, number: 9921, issueDate: days(-4), dueDate: days(26), otherTaxes: '2150', notes: null,
    lines: rec.lines.map((l) => ({
      receiptLineId: l.id, itemId: l.itemId, description: l.itemId === broche ? 'Broches a presión' : 'Etiquetas bordadas',
      qty: l.qty.toString(), unitPrice: l.unitCost.toString(), vatRate: '21',
    })),
  });

  console.log('Fase 2 demo: 6 etapas, 4 fichas técnicas, 6 tarifas de taller, 4 órdenes de producción, 2 órdenes de compra, 1 factura, 1 liquidación.');
}
