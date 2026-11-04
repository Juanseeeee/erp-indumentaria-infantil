import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  GoodsReceiptCreateInput,
  GoodsReceiptCreateSchema,
  PurchaseOrderCreateInput,
  PurchaseOrderCreateSchema,
  PurchaseRequestCreateSchema,
  SupplierInvoiceCreateInput,
  SupplierInvoiceCreateSchema,
} from '@erp/contracts';
import { Ctx, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { RequestContext } from '../common/context';
import { PurchasingService } from './purchasing.service';

const Page = z.object({
  status: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const ReceiptQuery = z.object({ supplierId: z.string().uuid().optional(), pendingInvoice: z.coerce.boolean().default(false) });
const Reason = z.object({ reason: z.string().trim().min(3, 'Indicá el motivo') });

@Controller('purchasing')
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  @Get('requests')
  @RequirePermissions('purchasing.view')
  requests(@Ctx() ctx: RequestContext, @Query(new ZodPipe(Page)) q: z.infer<typeof Page>) {
    return this.purchasing.listRequests(ctx, q.status);
  }

  @Post('requests')
  @RequirePermissions('purchasing.order')
  createRequest(@Ctx() ctx: RequestContext, @Body(new ZodPipe(PurchaseRequestCreateSchema)) b: z.infer<typeof PurchaseRequestCreateSchema>) {
    return this.purchasing.createRequest(ctx, b);
  }

  @Post('requests/:id/cancel')
  @RequirePermissions('purchasing.order')
  cancelRequest(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchasing.cancelRequest(ctx, id);
  }

  @Get('orders')
  @RequirePermissions('purchasing.view')
  orders(@Ctx() ctx: RequestContext, @Query(new ZodPipe(Page)) q: z.infer<typeof Page>) {
    return this.purchasing.listOrders(ctx, q);
  }

  @Get('orders/:id')
  @RequirePermissions('purchasing.view')
  order(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchasing.getOrder(ctx, id);
  }

  @Post('orders')
  @RequirePermissions('purchasing.order')
  createOrder(@Ctx() ctx: RequestContext, @Body(new ZodPipe(PurchaseOrderCreateSchema)) b: PurchaseOrderCreateInput) {
    return this.purchasing.createOrder(ctx, b);
  }

  @Post('orders/:id/approve')
  @RequirePermissions('purchasing.approve')
  approve(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchasing.approveOrder(ctx, id);
  }

  @Post('orders/:id/cancel')
  @RequirePermissions('purchasing.order')
  cancel(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>) {
    return this.purchasing.cancelOrder(ctx, id, b.reason);
  }

  @Get('receipts')
  @RequirePermissions('purchasing.view')
  receipts(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ReceiptQuery)) q: z.infer<typeof ReceiptQuery>) {
    return this.purchasing.listReceipts(ctx, q);
  }

  @Get('receipts/:id')
  @RequirePermissions('purchasing.view')
  receipt(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchasing.getReceipt(ctx, id);
  }

  @Post('receipts')
  @RequirePermissions('purchasing.receive')
  createReceipt(@Ctx() ctx: RequestContext, @Body(new ZodPipe(GoodsReceiptCreateSchema)) b: GoodsReceiptCreateInput) {
    return this.purchasing.createReceipt(ctx, b);
  }

  @Get('invoices')
  @RequirePermissions('purchasing.view')
  invoices(@Ctx() ctx: RequestContext, @Query(new ZodPipe(Page)) q: z.infer<typeof Page>) {
    return this.purchasing.listInvoices(ctx, q);
  }

  @Get('invoices/:id')
  @RequirePermissions('purchasing.view')
  invoice(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchasing.getInvoice(ctx, id);
  }

  @Post('invoices')
  @RequirePermissions('purchasing.invoice')
  createInvoice(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SupplierInvoiceCreateSchema)) b: SupplierInvoiceCreateInput) {
    return this.purchasing.createInvoice(ctx, b);
  }
}
