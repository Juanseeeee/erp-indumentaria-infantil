import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  PromotionUpsertSchema,
  type PromotionUpsertInput,
  CommissionSettleSchema,
  CreditNoteCreateInput,
  CreditNoteCreateSchema,
  DebitNoteCreateInput,
  DebitNoteCreateSchema,
  DeliveryCreateInput,
  DeliveryCreateSchema,
  PriceBulkUpdateInput,
  PriceBulkUpdateSchema,
  PriceListUpsertInput,
  PriceListUpsertSchema,
  PriceSetInput,
  PriceSetSchema,
  ReceiptCreateInput,
  ReceiptCreateSchema,
  SalesInvoiceCreateInput,
  SalesInvoiceCreateSchema,
  SalesOrderConfirmSchema,
  SalesOrderUpsertInput,
  SalesOrderUpsertSchema,
  SalesRepUpsertSchema,
  VoidSchema,
} from '@erp/contracts';
import { Ctx, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { RequestContext } from '../common/context';
import { PricingService } from './pricing.service';
import { SalesOrdersService } from './sales-orders.service';
import { DeliveriesService } from './deliveries.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { ReceiptsService } from './receipts.service';
import { CommissionsService } from './commissions.service';
import { PromotionsService } from './promotions.service';

const Page = z.object({
  status: z.string().optional(),
  customerId: z.string().uuid().optional(),
  kind: z.enum(['F', 'NC', 'ND']).optional(),
  pendingInvoice: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
type PageQ = z.infer<typeof Page>;
const Reason = VoidSchema;
const CommissionQuery = z.object({ sellerUserId: z.string().uuid().optional(), pending: z.coerce.boolean().default(false) });

@Controller('sales')
export class SalesController {
  constructor(
    private readonly pricing: PricingService,
    private readonly orders: SalesOrdersService,
    private readonly deliveries: DeliveriesService,
    private readonly invoices: SalesInvoicesService,
    private readonly receipts: ReceiptsService,
    private readonly commissions: CommissionsService,
    private readonly promotions: PromotionsService,
  ) {}

  // ─── Listas de precios ───
  @Get('price-lists')
  @RequirePermissions('sales.view')
  lists(@Ctx() ctx: RequestContext) {
    return this.pricing.lists(ctx);
  }

  @Post('price-lists')
  @RequirePermissions('sales.prices.manage')
  createList(@Ctx() ctx: RequestContext, @Body(new ZodPipe(PriceListUpsertSchema)) b: PriceListUpsertInput) {
    return this.pricing.upsertList(ctx, b);
  }

  @Put('price-lists/:id')
  @RequirePermissions('sales.prices.manage')
  updateList(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(PriceListUpsertSchema)) b: PriceListUpsertInput) {
    return this.pricing.upsertList(ctx, b, id);
  }

  @Get('price-lists/:id/prices')
  @RequirePermissions('sales.view')
  prices(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.pricing.prices(ctx, id);
  }

  @Post('price-lists/:id/prices')
  @RequirePermissions('sales.prices.manage')
  setPrices(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(PriceSetSchema)) b: PriceSetInput) {
    return this.pricing.setPrices(ctx, id, b);
  }

  @Post('price-lists/:id/bulk')
  @RequirePermissions('sales.prices.manage')
  bulk(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(PriceBulkUpdateSchema)) b: PriceBulkUpdateInput) {
    return this.pricing.bulkUpdate(ctx, id, b);
  }

  @Get('price-lists/:id/history/:productId')
  @RequirePermissions('sales.view')
  history(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.pricing.history(ctx, id, productId);
  }

  @Get('price-lists/:id/products/:productId')
  @RequirePermissions('sales.view')
  productPrices(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.pricing.forProduct(ctx, id, productId);
  }

  // ─── Pedidos ───
  @Get('customers/:id/context')
  @RequirePermissions('sales.view')
  customerContext(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.customerContext(ctx, id);
  }

  @Get('orders')
  @RequirePermissions('sales.view')
  listOrders(@Ctx() ctx: RequestContext, @Query(new ZodPipe(Page)) q: PageQ) {
    return this.orders.list(ctx, q);
  }

  @Get('orders/:id')
  @RequirePermissions('sales.view')
  order(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detail(ctx, id);
  }

  // ─── Promociones ───
  @Get('promotions')
  @RequirePermissions('sales.view')
  listPromotions(@Ctx() ctx: RequestContext) {
    return this.promotions.list(ctx);
  }

  @Post('promotions')
  @RequirePermissions('sales.prices.manage')
  createPromotion(@Ctx() ctx: RequestContext, @Body(new ZodPipe(PromotionUpsertSchema)) b: PromotionUpsertInput) {
    return this.promotions.create(ctx, b);
  }

  @Put('promotions/:id')
  @RequirePermissions('sales.prices.manage')
  updatePromotion(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(PromotionUpsertSchema)) b: PromotionUpsertInput) {
    return this.promotions.update(ctx, id, b);
  }

  /** Precios, descuentos y promociones que tendría el pedido, sin guardarlo. */
  @Post('orders/preview')
  @RequirePermissions('sales.order')
  previewOrder(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SalesOrderUpsertSchema)) b: SalesOrderUpsertInput) {
    return this.orders.preview(ctx, b);
  }

  @Post('orders')
  @RequirePermissions('sales.order')
  createOrder(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SalesOrderUpsertSchema)) b: SalesOrderUpsertInput) {
    return this.orders.create(ctx, b);
  }

  @Put('orders/:id')
  @RequirePermissions('sales.order')
  updateOrder(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(SalesOrderUpsertSchema)) b: SalesOrderUpsertInput) {
    return this.orders.update(ctx, id, b);
  }

  @Post('orders/:id/confirm')
  @RequirePermissions('sales.order')
  confirm(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(SalesOrderConfirmSchema)) b: z.infer<typeof SalesOrderConfirmSchema>) {
    return this.orders.confirm(ctx, id, b);
  }

  @Post('orders/:id/reserve')
  @RequirePermissions('sales.order')
  reserve(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.reservePending(ctx, id);
  }

  @Post('orders/:id/cancel')
  @RequirePermissions('sales.order')
  cancel(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Reason)) b: { reason: string }) {
    return this.orders.cancel(ctx, id, b.reason);
  }

  // ─── Remitos ───
  @Get('deliveries')
  @RequirePermissions('sales.view')
  listDeliveries(@Ctx() ctx: RequestContext, @Query(new ZodPipe(Page)) q: PageQ) {
    return this.deliveries.list(ctx, q);
  }

  @Get('deliveries/:id')
  @RequirePermissions('sales.view')
  delivery(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.detail(ctx, id);
  }

  @Post('deliveries')
  @RequirePermissions('sales.deliver')
  createDelivery(@Ctx() ctx: RequestContext, @Body(new ZodPipe(DeliveryCreateSchema)) b: DeliveryCreateInput) {
    return this.deliveries.create(ctx, b);
  }

  @Post('deliveries/:id/void')
  @RequirePermissions('sales.deliver')
  voidDelivery(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Reason)) b: { reason: string }) {
    return this.deliveries.void(ctx, id, b.reason);
  }

  // ─── Comprobantes ───
  @Get('documents')
  @RequirePermissions('sales.view')
  listDocuments(@Ctx() ctx: RequestContext, @Query(new ZodPipe(Page)) q: PageQ) {
    return this.invoices.list(ctx, q);
  }

  @Get('documents/:id')
  @RequirePermissions('sales.view')
  document(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.detail(ctx, id);
  }

  @Post('invoices')
  @RequirePermissions('sales.invoice')
  invoice(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SalesInvoiceCreateSchema)) b: SalesInvoiceCreateInput) {
    return this.invoices.createInvoice(ctx, b);
  }

  @Post('credit-notes')
  @RequirePermissions('sales.invoice')
  creditNote(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CreditNoteCreateSchema)) b: CreditNoteCreateInput) {
    return this.invoices.createCreditNote(ctx, b);
  }

  @Post('debit-notes')
  @RequirePermissions('sales.invoice')
  debitNote(@Ctx() ctx: RequestContext, @Body(new ZodPipe(DebitNoteCreateSchema)) b: DebitNoteCreateInput) {
    return this.invoices.createDebitNote(ctx, b);
  }

  @Post('documents/:id/authorize')
  @RequirePermissions('sales.invoice')
  authorize(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.authorize(ctx, id);
  }

  // ─── Cobros ───
  @Get('receipts')
  @RequirePermissions('accounts.receivable.view')
  listReceipts(@Ctx() ctx: RequestContext, @Query(new ZodPipe(Page)) q: PageQ) {
    return this.receipts.list(ctx, q);
  }

  @Get('receipts/:id')
  @RequirePermissions('accounts.receivable.view')
  receipt(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.detail(ctx, id);
  }

  @Post('receipts')
  @RequirePermissions('receivables.collect')
  createReceipt(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ReceiptCreateSchema)) b: ReceiptCreateInput) {
    return this.receipts.create(ctx, b);
  }

  @Post('receipts/:id/void')
  @RequirePermissions('receivables.collect')
  voidReceipt(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Reason)) b: { reason: string }) {
    return this.receipts.void(ctx, id, b.reason);
  }

  // ─── Vendedores y comisiones ───
  @Get('reps')
  @RequirePermissions('sales.commissions.manage')
  reps(@Ctx() ctx: RequestContext) {
    return this.commissions.reps(ctx);
  }

  @Put('reps')
  @RequirePermissions('sales.commissions.manage')
  upsertRep(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SalesRepUpsertSchema)) b: z.infer<typeof SalesRepUpsertSchema>) {
    return this.commissions.upsertRep(ctx, b);
  }

  /** Vendedores activos (para asignar a clientes y pedidos). */
  @Get('sellers')
  @RequirePermissions('sales.view')
  sellers(@Ctx() ctx: RequestContext) {
    return this.commissions.sellers(ctx);
  }

  @Get('commissions')
  @RequirePermissions('sales.commissions.manage')
  listCommissions(@Ctx() ctx: RequestContext, @Query(new ZodPipe(CommissionQuery)) q: z.infer<typeof CommissionQuery>) {
    return this.commissions.list(ctx, q);
  }

  /** Cada vendedor ve solo lo suyo. */
  @Get('commissions/mine')
  @RequirePermissions('sales.view')
  myCommissions(@Ctx() ctx: RequestContext) {
    return this.commissions.list(ctx, { sellerUserId: ctx.userId });
  }

  @Post('commissions/settle')
  @RequirePermissions('sales.commissions.manage')
  settle(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CommissionSettleSchema)) b: z.infer<typeof CommissionSettleSchema>) {
    return this.commissions.settle(ctx, b);
  }
}
