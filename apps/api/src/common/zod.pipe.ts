import { PipeTransform } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';
import { DomainError, ErrorCodes } from '@erp/domain-core';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new DomainError(ErrorCodes.VALIDACION, 'Hay datos inválidos en el formulario.', 400, {
        fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
