import { Dec, DecimalLike, DomainError, ErrorCodes, dec, roundMoney, roundQty, roundUnitCost, sum } from '@erp/domain-core';

/** Línea de material de una ficha técnica (versión congelada). */
export interface BomLine {
  materialItemId: string | null;
  byGarmentColor: boolean;
  /** color de prenda → material */
  colorMap: Record<string, string>;
  qtyPerUnit: DecimalLike;
  /** talle → consumo (pisa qtyPerUnit) */
  sizeQty: Record<string, DecimalLike>;
  wastePct: DecimalLike;
}

export interface GarmentQty {
  variantItemId: string;
  sizeId: string;
  colorId: string;
  qty: DecimalLike;
}

/** Consumo unitario de una línea para un talle, incluida la merma. */
export function unitConsumption(line: BomLine, sizeId: string): Dec {
  const base = line.sizeQty[sizeId] !== undefined ? dec(line.sizeQty[sizeId]!) : dec(line.qtyPerUnit);
  return base.times(dec(1).plus(dec(line.wastePct).div(100)));
}

export function resolveMaterial(line: BomLine, colorId: string, colorName?: string): string {
  if (!line.byGarmentColor) {
    if (!line.materialItemId) throw new DomainError(ErrorCodes.VALIDACION, 'La ficha tiene una línea sin material.');
    return line.materialItemId;
  }
  const m = line.colorMap[colorId];
  if (!m) {
    throw new DomainError(
      ErrorCodes.VALIDACION,
      `La ficha técnica no indica qué material usar para el color ${colorName ?? colorId}.`,
      422,
      { colorId },
    );
  }
  return m;
}

/**
 * Explosión de materiales: para cada prenda a fabricar suma el consumo de cada material
 * (por talle, con merma y con material según el color de la prenda).
 */
export function explodeBom(bom: BomLine[], garments: GarmentQty[], colorNames: Record<string, string> = {}): Map<string, Dec> {
  const req = new Map<string, Dec>();
  for (const g of garments) {
    const qty = dec(g.qty);
    if (qty.lte(0)) continue;
    for (const line of bom) {
      const material = resolveMaterial(line, g.colorId, colorNames[g.colorId]);
      const add = unitConsumption(line, g.sizeId).times(qty);
      req.set(material, (req.get(material) ?? dec(0)).plus(add));
    }
  }
  for (const [k, v] of req) req.set(k, roundQty(v));
  return req;
}

export interface Availability {
  materialItemId: string;
  required: Dec;
  available: Dec;
  shortage: Dec;
}

export function shortages(required: Map<string, Dec>, available: Record<string, DecimalLike>): Availability[] {
  return [...required.entries()].map(([materialItemId, req]) => {
    const av = dec(available[materialItemId] ?? 0);
    const short = req.minus(av);
    return { materialItemId, required: req, available: av, shortage: short.gt(0) ? short : dec(0) };
  });
}

/**
 * Costo estimado por prenda de una variante: materiales (consumo × costo promedio) + tarifa de taller.
 * Es una ESTIMACIÓN: el costo real se calcula al cerrar la orden.
 */
export function estimateUnitCost(
  bom: BomLine[],
  garment: Pick<GarmentQty, 'sizeId' | 'colorId'>,
  materialCost: Record<string, DecimalLike>,
  workshopRate: DecimalLike = 0,
): { materials: Dec; workshop: Dec; total: Dec } {
  const materials = sum(
    bom.map((line) => {
      const m = resolveMaterial(line, garment.colorId);
      return unitConsumption(line, garment.sizeId).times(materialCost[m] ?? 0);
    }),
  );
  const workshop = dec(workshopRate);
  return { materials: roundUnitCost(materials), workshop, total: roundUnitCost(materials.plus(workshop)) };
}

/**
 * Consumo teórico (backflush) de materiales para una cantidad de prendas terminadas de una variante.
 * Se usa al recibir prendas de un taller: lo enviado se va consumiendo según la ficha.
 */
export function theoreticalConsumption(bom: BomLine[], garment: Omit<GarmentQty, 'variantItemId'>): Map<string, Dec> {
  return explodeBom(bom, [{ ...garment, variantItemId: '' }]);
}

export interface ActualCostInput {
  materials: DecimalLike;
  workshop: DecimalLike;
  overhead: DecimalLike;
  goodUnits: DecimalLike;
}

/** Costo real de la orden: el total se reparte sobre las unidades aprobadas (las falladas cargan el costo). */
export function actualUnitCost(i: ActualCostInput): { total: Dec; unitCost: Dec } {
  const total = roundMoney(dec(i.materials).plus(i.workshop).plus(i.overhead));
  const units = dec(i.goodUnits);
  return { total, unitCost: units.gt(0) ? roundUnitCost(total.div(units)) : dec(0) };
}

/** Transiciones válidas de una orden de producción. */
export const PRODUCTION_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['RELEASED', 'CANCELLED'],
  RELEASED: ['IN_PROGRESS', 'CANCELLED', 'COMPLETED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
  CANCELLED: [],
};

export function assertTransition(from: string, to: string) {
  if (!PRODUCTION_TRANSITIONS[from]?.includes(to)) {
    throw new DomainError(ErrorCodes.TRANSICION_INVALIDA, `Una orden en estado ${from} no puede pasar a ${to}.`);
  }
}
