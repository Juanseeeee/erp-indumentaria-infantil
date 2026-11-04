import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { DomainError, ErrorCodes } from '@erp/domain-core';

interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Traduce errores de dominio, de Prisma y de Nest a respuestas JSON en español. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.map(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(status).json(body);
  }

  private map(e: unknown): [number, ErrorBody] {
    if (e instanceof DomainError) {
      return [e.httpStatus, { code: e.code, message: e.message, details: e.details }];
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        const target = (e.meta?.target as string[] | string | undefined) ?? '';
        return [409, { code: ErrorCodes.DUPLICADO, message: `Ya existe un registro con ese valor (${String(target)}).` }];
      }
      if (e.code === 'P2025') {
        return [404, { code: ErrorCodes.NO_ENCONTRADO, message: 'El registro no existe.' }];
      }
      if (e.code === 'P2003') {
        return [422, { code: ErrorCodes.VALIDACION, message: 'Referencia a un registro inexistente.' }];
      }
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const code = status === 401 ? 'NO_AUTENTICADO' : status === 403 ? ErrorCodes.SIN_PERMISO : 'HTTP_' + status;
      const msg = status === 404 ? 'Recurso inexistente.' : e.message;
      return [status, { code, message: msg }];
    }
    // Violaciones de CHECK/trigger en PostgreSQL (defensa en profundidad).
    const raw = e instanceof Error ? e.message : '';
    const closed = /PERIODO_CERRADO:(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (closed) {
      const [, y, m, d] = closed;
      return [409, { code: 'PERIODO_CERRADO', message: `El período está cerrado hasta el ${d}/${m}/${y}: no se registran operaciones con fecha anterior. Usá una fecha posterior o pedí que se reabra.` }];
    }
    if (/check_violation|Stock negativo no permitido|23514/.test(raw)) {
      return [409, { code: ErrorCodes.STOCK_INSUFICIENTE, message: 'La operación dejaría el stock en negativo.' }];
    }
    return [500, { code: 'ERROR_INTERNO', message: 'Ocurrió un error inesperado. Ya quedó registrado.' }];
  }
}
