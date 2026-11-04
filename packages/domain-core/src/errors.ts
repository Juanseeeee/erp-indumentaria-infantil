/**
 * Error de negocio con código estable (para tests y para la UI) y mensaje en español.
 * La API lo traduce a HTTP según `httpStatus`.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 422,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const ErrorCodes = {
  STOCK_INSUFICIENTE: 'STOCK_INSUFICIENTE',
  RESERVA_INSUFICIENTE: 'RESERVA_INSUFICIENTE',
  CONVERSION_INCOMPATIBLE: 'CONVERSION_INCOMPATIBLE',
  CANTIDAD_INVALIDA: 'CANTIDAD_INVALIDA',
  DUPLICADO: 'DUPLICADO',
  NO_ENCONTRADO: 'NO_ENCONTRADO',
  TRANSICION_INVALIDA: 'TRANSICION_INVALIDA',
  CONFLICTO_VERSION: 'CONFLICTO_VERSION',
  SIN_PERMISO: 'SIN_PERMISO',
  REQUIERE_APROBACION: 'REQUIERE_APROBACION',
  VALIDACION: 'VALIDACION',
} as const;
