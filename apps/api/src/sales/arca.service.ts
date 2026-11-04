import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DomainError, ErrorCodes } from '@erp/domain-core';
import type { buildFeCaeDetail } from '@erp/domain-sales';
import type { Tx } from '../prisma/prisma.service';
import { readSetting } from '../common/common.service';

export type ArcaMode = 'SIMULATED' | 'HOMOLOGATION' | 'PRODUCTION';

export interface ArcaAuthorization {
  approved: boolean;
  cae?: string;
  caeDueDate?: Date;
  /** Observaciones o errores devueltos (en rechazos, el motivo). */
  messages: string[];
  raw: unknown;
}

export interface ArcaProvider {
  readonly mode: ArcaMode;
  /** Último número autorizado para el punto de venta y tipo (FECompUltimoAutorizado). */
  lastAuthorized(tx: Tx, companyId: string, pointOfSale: number, docType: string): Promise<number>;
  /** Solicita el CAE (FECAESolicitar). */
  authorize(tx: Tx, companyId: string, request: ReturnType<typeof buildFeCaeDetail>, docId: string): Promise<ArcaAuthorization>;
}

/**
 * Proveedor simulado para desarrollo y demostraciones. Valida el pedido con las mismas reglas que
 * se envían a ARCA y numera correlativo por punto de venta y tipo, pero el CAE es FICTICIO:
 * los comprobantes quedan marcados "SIMULATED" y no tienen validez fiscal.
 * `arca.simulateRejection` = true fuerza un rechazo (para probar ese circuito).
 */
class SimulatedArcaProvider implements ArcaProvider {
  readonly mode = 'SIMULATED' as const;

  async lastAuthorized(tx: Tx, _companyId: string, pointOfSale: number, docType: string) {
    const r = await tx.fiscalDocument.aggregate({ where: { direction: 'SALE', pointOfSale, docType, number: { not: null } }, _max: { number: true } });
    return r._max.number ?? 0;
  }

  async authorize(tx: Tx, companyId: string, request: ReturnType<typeof buildFeCaeDetail>, docId: string): Promise<ArcaAuthorization> {
    if (await readSetting(tx, companyId, 'arca.simulateRejection', false)) {
      return { approved: false, messages: ['10016: Rechazo simulado (arca.simulateRejection activo).'], raw: { simulated: true, request } };
    }
    const digits = BigInt(`0x${createHash('sha256').update(docId).digest('hex').slice(0, 15)}`).toString().padStart(14, '0').slice(-14);
    const d = request.FECAEDetRequest.CbteFch;
    const due = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 10);
    return { approved: true, cae: digits, caeDueDate: due, messages: ['CAE simulado: sin validez fiscal.'], raw: { simulated: true, request } };
  }
}

@Injectable()
export class ArcaService {
  private readonly simulated = new SimulatedArcaProvider();

  async provider(tx: Tx, companyId: string): Promise<ArcaProvider> {
    const mode = await readSetting<ArcaMode>(tx, companyId, 'arca.mode', 'SIMULATED');
    if (mode === 'SIMULATED') return this.simulated;
    // WSAA + WSFEv1 requieren el certificado de la empresa (generado con clave fiscal). Hasta tenerlo
    // y probar en homologación no se habilita: preferimos frenar antes que emitir algo no validado.
    throw new DomainError(
      ErrorCodes.VALIDACION,
      `La conexión con ARCA (${mode === 'PRODUCTION' ? 'producción' : 'homologación'}) todavía no está configurada: falta el certificado digital de la empresa.`,
    );
  }
}
