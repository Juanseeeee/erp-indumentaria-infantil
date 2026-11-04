/**
 * Datos de demostración: "Ositos Algodón SRL" (empresa FICTICIA).
 * Ningún dato es real: CUITs inventados con dígito verificador válido, contraseñas solo para demo.
 *
 * La plataforma (empresa, roles, usuarios) se crea con el rol propietario; el resto se carga
 * a través de los servicios de la API para ejercitar las mismas validaciones y el motor de stock.
 *
 * Uso: pnpm db:seed  (NO ejecutar en producción)
 */
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, PERMISSIONS, PERMISSION_MODULE, SYSTEM_ROLES } from '@erp/contracts';
import { AppModule } from '../../src/app.module';
import { hashPassword } from '../../src/auth/auth.service';
import { SettingsService } from '../../src/settings/settings.service';
import { PartiesService } from '../../src/parties/parties.service';
import { CatalogService } from '../../src/catalog/catalog.service';
import { MaterialsService } from '../../src/materials/materials.service';
import { StockDocumentsService } from '../../src/inventory/stock-documents.service';
import type { RequestContext } from '../../src/common/context';
import { seedFase2 } from './fase2';
import { seedFase3 } from './fase3';
import { seedFase4 } from './fase4';
import { seedFase5 } from './fase5';

export const DEMO_PASSWORD = 'Demo2026erp';
const COMPANY_CUIT = '30712345671';

const DEMO_USERS: { email: string; name: string; role: keyof typeof SYSTEM_ROLES }[] = [
  { email: 'admin@ositos.demo', name: 'Sofía Superadmin', role: 'SUPERADMIN' },
  { email: 'direccion@ositos.demo', name: 'Laura Dirección', role: 'OWNER' },
  { email: 'administracion@ositos.demo', name: 'Martín Administración', role: 'ADMIN' },
  { email: 'compras@ositos.demo', name: 'Carla Compras', role: 'PURCHASING' },
  { email: 'produccion@ositos.demo', name: 'Diego Producción', role: 'PRODUCTION' },
  { email: 'operario@ositos.demo', name: 'Marta Operaria', role: 'OPERATOR' },
  { email: 'deposito@ositos.demo', name: 'Nico Depósito', role: 'WAREHOUSE' },
  { email: 'ventas@ositos.demo', name: 'Paula Ventas', role: 'SALES' },
  { email: 'tesoreria@ositos.demo', name: 'Jorge Tesorería', role: 'TREASURY' },
  { email: 'contabilidad@ositos.demo', name: 'Ana Contabilidad', role: 'ACCOUNTING' },
  { email: 'auditor@ositos.demo', name: 'Raúl Auditor', role: 'AUDITOR' },
];

async function seedPlatform(owner: PrismaClient) {
  await owner.permission.createMany({
    data: ALL_PERMISSIONS.map((code) => ({ code, module: PERMISSION_MODULE(code), description: PERMISSIONS[code] })),
    skipDuplicates: true,
  });

  const company = await owner.company.upsert({
    where: { cuit: COMPANY_CUIT },
    create: {
      legalName: 'Ositos Algodón SRL',
      tradeName: 'Ositos',
      cuit: COMPANY_CUIT,
      taxCondition: 'RI',
      address: 'Av. Siempreviva 742, Villa Crespo, CABA',
    },
    update: {},
  });
  await owner.branch.upsert({
    where: { companyId_name: { companyId: company.id, name: 'Casa central' } },
    create: { companyId: company.id, name: 'Casa central', arcaPointOfSale: 1 },
    update: {},
  });

  const roleIds: Record<string, string> = {};
  for (const [code, def] of Object.entries(SYSTEM_ROLES)) {
    const role = await owner.role.upsert({
      where: { companyId_code: { companyId: company.id, code } },
      create: { companyId: company.id, code, name: def.name, isSystem: true },
      update: { name: def.name },
    });
    await owner.rolePermission.deleteMany({ where: { roleId: role.id } });
    await owner.rolePermission.createMany({
      data: def.permissions.map((p) => ({ roleId: role.id, permissionCode: p, companyId: company.id })),
    });
    roleIds[code] = role.id;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userIds: Record<string, string> = {};
  for (const u of DEMO_USERS) {
    const user = await owner.user.upsert({
      where: { email: u.email },
      create: { email: u.email, name: u.name, passwordHash },
      update: { passwordHash, failedLogins: 0, lockedUntil: null },
    });
    await owner.companyUser.upsert({
      where: { companyId_userId: { companyId: company.id, userId: user.id } },
      create: { companyId: company.id, userId: user.id },
      update: { isActive: true },
    });
    await owner.userRole.upsert({
      where: { companyId_userId_roleId: { companyId: company.id, userId: user.id, roleId: roleIds[u.role]! } },
      create: { companyId: company.id, userId: user.id, roleId: roleIds[u.role]! },
      update: {},
    });
    userIds[u.role] = user.id;
  }
  return { companyId: company.id, adminId: userIds.SUPERADMIN! };
}

async function main() {
  const owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_MIGRATION_URL } } });
  const { companyId, adminId } = await seedPlatform(owner);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const ctx: RequestContext = {
    companyId,
    userId: adminId,
    sessionId: 'seed',
    permissions: new Set(ALL_PERMISSIONS),
  };
  const alreadySeeded = await owner.product.count({ where: { companyId } });
  if (alreadySeeded > 0) {
    console.log('Fase 1 ya cargada: se omite.');
    await seedFase2(app, owner, ctx);
    await seedFase3(app, owner, ctx);
    await seedFase4(app, owner, ctx);
    await seedFase5(app, owner, ctx);
    await app.close();
    await owner.$disconnect();
    return;
  }
  const settings = app.get(SettingsService);
  const parties = app.get(PartiesService);
  const catalog = app.get(CatalogService);
  const materials = app.get(MaterialsService);
  const stockDocs = app.get(StockDocumentsService);

  // ─── Datos maestros ───
  const uom: Record<string, string> = {};
  for (const [code, name, dimension] of [
    ['un', 'Unidades', 'UNIT'],
    ['m', 'Metros', 'LENGTH'],
    ['cm', 'Centímetros', 'LENGTH'],
    ['kg', 'Kilogramos', 'MASS'],
    ['g', 'Gramos', 'MASS'],
    ['rollo', 'Rollos', 'UNIT'],
    ['cono', 'Conos', 'UNIT'],
  ] as const) {
    uom[code] = (await settings.createUom(ctx, { code, name, dimension })).id;
  }
  await settings.createConversion(ctx, { fromUomId: uom.m!, toUomId: uom.cm!, factor: '100', itemId: null });
  await settings.createConversion(ctx, { fromUomId: uom.kg!, toUomId: uom.g!, factor: '1000', itemId: null });

  const color: Record<string, string> = {};
  for (const [code, name, hex] of [
    ['BLA', 'Blanco', '#FFFFFF'],
    ['ROS', 'Rosa', '#F4C2C2'],
    ['CEL', 'Celeste', '#BFDDF2'],
    ['BEI', 'Beige', '#E8DCC4'],
    ['GRI', 'Gris melange', '#B8B8B8'],
    ['VER', 'Verde agua', '#BFE3D6'],
  ] as const) {
    color[code] = (await settings.createColor(ctx, { code, name, hex })).id;
  }

  const bebe = await settings.createSizeScale(ctx, { name: 'Bebé', sizes: ['RN', '0-3', '3-6', '6-9', '9-12'] });
  const ninos = await settings.createSizeScale(ctx, { name: 'Primera infancia', sizes: ['1', '2', '3', '4'] });

  const cat: Record<string, string> = {};
  for (const [name, kind] of [
    ['Bodies', 'PRODUCT'],
    ['Enteritos', 'PRODUCT'],
    ['Conjuntos', 'PRODUCT'],
    ['Pantalones', 'PRODUCT'],
    ['Accesorios', 'PRODUCT'],
    ['Telas', 'MATERIAL'],
    ['Avíos', 'MATERIAL'],
    ['Hilos', 'MATERIAL'],
    ['Packaging', 'MATERIAL'],
  ] as const) {
    cat[name] = (await settings.createCategory(ctx, { name, kind, parentId: null })).id;
  }
  const season = await settings.createSeason(ctx, { name: 'Otoño-Invierno 2027', year: 2027 });
  const coleccion = await settings.createCollection(ctx, { name: 'Bosque OI27', seasonId: season.id });

  const depPT = await settings.createWarehouse(ctx, { code: 'PT', name: 'Depósito producto terminado', type: 'OWN', partyId: null });
  const depMP = await settings.createWarehouse(ctx, { code: 'MP', name: 'Depósito materias primas', type: 'OWN', partyId: null });
  await settings.createWarehouse(ctx, { code: 'CUAR', name: 'Cuarentena / segunda selección', type: 'QUARANTINE', partyId: null });

  const t30 = await settings.createPaymentTerm(ctx, { name: '30 días', days: [30] });
  await settings.createPaymentTerm(ctx, { name: 'Contado', days: [0] });
  await settings.createPaymentTerm(ctx, { name: '30/60/90', days: [30, 60, 90] });
  const zonaCaba = await settings.createZone(ctx, { name: 'CABA' });
  await settings.createZone(ctx, { name: 'GBA Norte' });
  await settings.createZone(ctx, { name: 'Interior' });
  await settings.upsertApprovalRule(ctx, { actionCode: 'inventory.adjust', threshold: '150000', isActive: true });

  // ─── Terceros (ficticios) ───
  const customers = [
    ['Pañalera Los Ositos de Flores SRL', '30700000016'],
    ['Baby Mundo Distribuidora SA', '30700000024'],
    ['Chiquitines Ramos Mejía SRL', '30700000032'],
    ['Mi Primer Ajuar SA', '30700000040'],
    ['Pequeños Pasos Rosario SRL', '30700000059'],
  ];
  for (const [legalName, taxId] of customers) {
    await parties.create(ctx, {
      legalName: legalName!,
      taxIdType: 'CUIT',
      taxId: taxId!,
      taxCondition: 'RI',
      roles: ['CUSTOMER'],
      address: { street: 'Calle Falsa 123', city: 'CABA', province: 'Buenos Aires', zip: null },
      customer: { creditLimit: '2500000', discountPct: '5', paymentTermId: t30.id, zoneId: zonaCaba.id },
      tradeName: null,
      email: null,
      phone: null,
      notes: null,
    });
  }
  await parties.create(ctx, {
    legalName: 'Valeria Gómez (Boutique Mimitos)',
    taxIdType: 'CUIT',
    taxId: '27300000067',
    taxCondition: 'MONOTRIBUTO',
    roles: ['CUSTOMER'],
    customer: { creditLimit: '400000', discountPct: '0' },
    tradeName: 'Mimitos',
    email: null,
    phone: null,
    notes: null,
  });

  const suppliers: Record<string, string> = {};
  for (const [legalName, taxId] of [
    ['Textil Algodonera del Oeste SA', '30700000083'],
    ['Avíos y Botones Once SRL', '30700000091'],
    ['Hilados Patagonia SA', '30700000105'],
    ['Packaging Feliz SRL', '30700000139'],
  ]) {
    const p = await parties.create(ctx, {
      legalName: legalName!,
      taxIdType: 'CUIT',
      taxId: taxId!,
      taxCondition: 'RI',
      roles: ['SUPPLIER'],
      tradeName: null,
      email: null,
      phone: null,
      notes: null,
    });
    suppliers[legalName!] = p.id;
  }
  for (const [legalName, taxId] of [
    ['Taller de Costura Rosa Benítez', '27300000113'],
    ['Taller Confecciones Ramírez', '20300000127'],
  ]) {
    await parties.create(ctx, {
      legalName: legalName!,
      taxIdType: 'CUIT',
      taxId: taxId!,
      taxCondition: 'MONOTRIBUTO',
      roles: ['WORKSHOP', 'SUPPLIER'],
      tradeName: null,
      email: null,
      phone: null,
      notes: 'Confección de bodies y enteritos. Recibe piezas cortadas.',
    });
  }

  // ─── Materias primas ───
  const mat = async (
    sku: string,
    name: string,
    u: string,
    category: string,
    supplier: string,
    extra: Partial<Parameters<MaterialsService['create']>[1]> = {},
  ) =>
    (
      await materials.create(ctx, {
        sku,
        name,
        baseUomId: uom[u]!,
        categoryId: cat[category]!,
        defaultSupplierId: suppliers[supplier]!,
        trackLots: false,
        minStock: null,
        reorderQty: null,
        barcode: null,
        purchaseUomId: null,
        fabricWidthCm: null,
        composition: null,
        weightGsm: null,
        colorId: null,
        ...extra,
      })
    ).itemId;

  const telaSup = 'Textil Algodonera del Oeste SA';
  const materialStock: { id: string; qty: string; cost: string; lot?: string }[] = [];
  for (const [code, colorName] of [['BLA', 'blanco'], ['ROS', 'rosa'], ['CEL', 'celeste'], ['BEI', 'beige']] as const) {
    const id = await mat(`TELA-INTERLOCK-${code}`, `Interlock peinado 24/1 ${colorName}`, 'm', 'Telas', telaSup, {
      trackLots: true,
      fabricWidthCm: '180',
      composition: '100% algodón',
      weightGsm: '210',
      colorId: color[code]!,
      minStock: '150',
    });
    materialStock.push({ id, qty: code === 'CEL' ? '95' : '320', cost: '4850', lot: `P-${code}-0927` });
  }
  const frisa = await mat('TELA-FRISA-GRI', 'Frisa invisible gris melange', 'm', 'Telas', telaSup, {
    trackLots: true, fabricWidthCm: '170', composition: '80% algodón 20% poliéster', weightGsm: '280', colorId: color.GRI!, minStock: '80',
  });
  materialStock.push({ id: frisa, qty: '140', cost: '6200', lot: 'P-GRI-1027' });
  const rib = await mat('TELA-RIB-BLA', 'Rib 1x1 blanco (puños)', 'm', 'Telas', telaSup, { colorId: color.BLA!, minStock: '40' });
  materialStock.push({ id: rib, qty: '60', cost: '3900' });

  const avios: [string, string, string, string, string, string, string][] = [
    ['AVIO-BROCHE-PRESION', 'Broche a presión plástico blanco', 'un', 'Avíos', 'Avíos y Botones Once SRL', '12000', '18.5'],
    ['AVIO-ETIQ-MARCA', 'Etiqueta bordada de marca', 'un', 'Avíos', 'Avíos y Botones Once SRL', '3500', '42'],
    ['AVIO-ETIQ-TALLE', 'Etiqueta de talle (set)', 'un', 'Avíos', 'Avíos y Botones Once SRL', '4200', '9.8'],
    ['AVIO-ELASTICO-15', 'Elástico 15 mm', 'm', 'Avíos', 'Avíos y Botones Once SRL', '800', '210'],
    ['HILO-POLI-BLA', 'Hilo poliéster 40/2 blanco', 'cono', 'Hilos', 'Hilados Patagonia SA', '45', '3200'],
    ['HILO-POLI-ROS', 'Hilo poliéster 40/2 rosa', 'cono', 'Hilos', 'Hilados Patagonia SA', '6', '3200'],
    ['PACK-BOLSA-CHICA', 'Bolsa polietileno con cierre 20x25', 'un', 'Packaging', 'Packaging Feliz SRL', '2500', '35'],
    ['PACK-CAJA-REGALO', 'Caja regalo ajuar', 'un', 'Packaging', 'Packaging Feliz SRL', '120', '890'],
  ];
  for (const [sku, name, u, category, sup, qty, cost] of avios) {
    const id = await mat(sku, name, u, category, sup, { minStock: sku === 'HILO-POLI-ROS' ? '10' : null });
    materialStock.push({ id, qty, cost });
  }

  // ─── Catálogo ───
  const products = [
    { code: 'BODY-ML', name: 'Body manga larga', category: 'Bodies', scale: bebe, colors: ['BLA', 'ROS', 'CEL', 'BEI'] },
    { code: 'BODY-MC', name: 'Body manga corta', category: 'Bodies', scale: bebe, colors: ['BLA', 'ROS', 'CEL'] },
    { code: 'ENT-OSITO', name: 'Enterito con pie Osito', category: 'Enteritos', scale: bebe, colors: ['BEI', 'GRI', 'CEL'] },
    { code: 'ENT-ZORRO', name: 'Enterito frisa Zorrito', category: 'Enteritos', scale: bebe, colors: ['GRI', 'VER'] },
    { code: 'PANT-RIB', name: 'Pantalón rib con pie', category: 'Pantalones', scale: bebe, colors: ['BLA', 'ROS', 'CEL', 'BEI', 'GRI'] },
    { code: 'CONJ-BOSQUE', name: 'Conjunto buzo y pantalón Bosque', category: 'Conjuntos', scale: ninos, colors: ['GRI', 'VER', 'BEI'] },
    { code: 'BABERO-X3', name: 'Babero pack x3', category: 'Accesorios', scale: bebe, colors: ['BLA'] },
    { code: 'GORRO-NUDO', name: 'Gorrito con nudo', category: 'Accesorios', scale: bebe, colors: ['BLA', 'ROS', 'CEL', 'BEI'] },
  ];
  const productIds: string[] = [];
  for (const p of products) {
    const created = await catalog.create(ctx, {
      code: p.code,
      name: p.name,
      categoryId: cat[p.category]!,
      collectionId: coleccion.id,
      sizeScaleId: p.scale.id,
      colorIds: p.colors.map((c) => color[c]!),
      status: 'ACTIVE',
      description: null,
      materialText: 'Algodón',
    });
    productIds.push(created.id);
  }

  // ─── Stock inicial ───
  await stockDocs.create(ctx, {
    type: 'OPENING',
    warehouseId: depMP.id,
    reason: 'Stock inicial demo',
    notes: null,
    targetWarehouseId: null,
    post: true,
    lines: materialStock.map((m) => ({ itemId: m.id, qty: m.qty, unitCost: m.cost, lotCode: m.lot ?? null })),
  });

  const variantLines: { itemId: string; qty: string; unitCost: string }[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (const pid of productIds) {
    const matrix = await catalog.matrix(ctx, pid);
    for (const cell of matrix.cells) {
      const qty = Math.floor(rnd() * 60);
      if (qty < 4) continue; // algunas variantes sin stock (para ver alertas y faltantes)
      variantLines.push({ itemId: cell.itemId, qty: String(qty), unitCost: String(4200 + Math.floor(rnd() * 30) * 100) });
    }
  }
  await stockDocs.create(ctx, {
    type: 'OPENING',
    warehouseId: depPT.id,
    reason: 'Stock inicial demo',
    notes: null,
    targetWarehouseId: null,
    post: true,
    lines: variantLines,
  });

  console.log(`Seed demo OK: ${productIds.length} modelos, ${variantLines.length} variantes con stock, ${materialStock.length} materiales.`);
  await seedFase2(app, owner, ctx);
  await seedFase3(app, owner, ctx);
  await seedFase4(app, owner, ctx);
  await seedFase5(app, owner, ctx);
  console.log(`Usuarios demo (contraseña "${DEMO_PASSWORD}"):`);
  for (const u of DEMO_USERS) console.log(`  ${u.email.padEnd(30)} ${SYSTEM_ROLES[u.role]!.name}`);
  await app.close();
  await owner.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
