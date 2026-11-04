import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  CashAccountCreateInput,
  CashAccountCreateSchema,
  ChequeCreditInput,
  ChequeCreditSchema,
  ChequeDebitInput,
  ChequeDebitSchema,
  ChequeDepositInput,
  ChequeDepositSchema,
  ChequeQuery,
  ChequeQuerySchema,
  ChequeRejectInput,
  ChequeRejectSchema,
  TreasuryMovementCreateInput,
  TreasuryMovementCreateSchema,
  TreasuryMovementQuerySchema,
  SupplierPaymentCreateInput,
  SupplierPaymentCreateSchema,
  SupplierPaymentQuery,
  SupplierPaymentQuerySchema,
  VoidSchema,
  CashClosingCreateInput,
  CashClosingCreateSchema,
  DateRangeQuery,
  DateRangeQuerySchema,
  ExpenseCreateInput,
  ExpenseCreateSchema,
  ExpenseQuery,
  ExpenseQuerySchema,
  ExpenseTemplateCreateInput,
  ExpenseTemplateCreateSchema,
  ExpenseTemplateRegisterInput,
  ExpenseTemplateRegisterSchema,
  TreasuryTransferCreateInput,
  TreasuryTransferCreateSchema,
  CashflowQuery,
  CashflowQuerySchema,
  StatementImportInput,
  StatementImportSchema,
  StatementLineCreateInput,
  StatementLineCreateSchema,
  StatementLineIgnoreInput,
  StatementLineIgnoreSchema,
  StatementLineMatchInput,
  StatementLineMatchSchema,
} from '@erp/contracts';
import { z } from 'zod';
import { Ctx, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { RequestContext } from '../common/context';
import { TreasuryService } from './treasury.service';
import { ChequesService } from './cheques.service';
import { SupplierPaymentsService } from './supplier-payments.service';
import { CashOperationsService } from './cash-operations.service';
import { ExpensesService } from './expenses.service';
import { StatementsService } from './statements.service';
import { CashflowService } from './cashflow.service';

const ClosingQuerySchema = DateRangeQuerySchema.extend({ cashAccountId: z.string().uuid().optional() });
const StatementQuerySchema = z.object({ cashAccountId: z.string().uuid().optional() });
const PreviewQuerySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

@Controller('treasury')
export class TreasuryController {
  constructor(
    private readonly treasury: TreasuryService,
    private readonly cheques: ChequesService,
    private readonly payments: SupplierPaymentsService,
    private readonly cashOps: CashOperationsService,
    private readonly expenses: ExpensesService,
    private readonly statements: StatementsService,
    private readonly cashflow: CashflowService,
  ) {}

  @Get('cashflow')
  @RequirePermissions('treasury.view')
  projectCashflow(@Ctx() ctx: RequestContext, @Query(new ZodPipe(CashflowQuerySchema)) query: CashflowQuery) {
    return this.cashflow.project(ctx, query);
  }

  @Get('accounts')
  @RequirePermissions('treasury.view')
  accounts(@Ctx() ctx: RequestContext) {
    return this.treasury.listAccounts(ctx);
  }

  @Post('accounts')
  @RequirePermissions('treasury.accounts.manage')
  createAccount(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CashAccountCreateSchema)) body: CashAccountCreateInput) {
    return this.treasury.createAccount(ctx, body);
  }

  @Get('accounts/:id/movements')
  @RequirePermissions('treasury.view')
  movements(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(TreasuryMovementQuerySchema)) query: ReturnType<typeof TreasuryMovementQuerySchema.parse>,
  ) {
    return this.treasury.listMovements(ctx, id, query);
  }

  @Post('accounts/:id/movements')
  @RequirePermissions('treasury.move')
  createMovement(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(TreasuryMovementCreateSchema)) body: TreasuryMovementCreateInput,
  ) {
    return this.treasury.createMovement(ctx, id, body);
  }

  @Get('cheques')
  @RequirePermissions('treasury.view')
  listCheques(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ChequeQuerySchema)) query: ChequeQuery) {
    return this.cheques.list(ctx, query);
  }

  @Get('cheques/:id')
  @RequirePermissions('treasury.view')
  cheque(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.cheques.detail(ctx, id);
  }

  @Post('cheques/:id/deposit')
  @RequirePermissions('treasury.move')
  deposit(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ChequeDepositSchema)) body: ChequeDepositInput) {
    return this.cheques.deposit(ctx, id, body);
  }

  @Post('cheques/:id/credit')
  @RequirePermissions('treasury.move')
  credit(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ChequeCreditSchema)) body: ChequeCreditInput) {
    return this.cheques.credit(ctx, id, body);
  }

  @Post('cheques/:id/reject')
  @RequirePermissions('treasury.move')
  reject(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ChequeRejectSchema)) body: ChequeRejectInput) {
    return this.cheques.reject(ctx, id, body);
  }

  @Post('cheques/:id/debit')
  @RequirePermissions('treasury.move')
  debit(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ChequeDebitSchema)) body: ChequeDebitInput) {
    return this.cheques.debit(ctx, id, body);
  }

  @Get('payments')
  @RequirePermissions('accounts.payable.view')
  listPayments(@Ctx() ctx: RequestContext, @Query(new ZodPipe(SupplierPaymentQuerySchema)) query: SupplierPaymentQuery) {
    return this.payments.list(ctx, query);
  }

  @Get('payments/:id')
  @RequirePermissions('accounts.payable.view')
  payment(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.detail(ctx, id);
  }

  @Post('payments')
  @RequirePermissions('payables.pay')
  createPayment(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SupplierPaymentCreateSchema)) body: SupplierPaymentCreateInput) {
    return this.payments.create(ctx, body);
  }

  @Post('payments/:id/approve')
  @RequirePermissions('payables.approve')
  approvePayment(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.approve(ctx, id);
  }

  @Post('payments/:id/reject')
  @RequirePermissions('payables.approve')
  rejectPayment(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VoidSchema)) body: { reason: string }) {
    return this.payments.reject(ctx, id, body.reason);
  }

  @Post('payments/:id/void')
  @RequirePermissions('payables.pay')
  voidPayment(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VoidSchema)) body: { reason: string }) {
    return this.payments.void(ctx, id, body.reason);
  }

  @Get('transfers')
  @RequirePermissions('treasury.view')
  listTransfers(@Ctx() ctx: RequestContext, @Query(new ZodPipe(DateRangeQuerySchema)) query: DateRangeQuery) {
    return this.cashOps.listTransfers(ctx, query);
  }

  @Post('transfers')
  @RequirePermissions('treasury.move')
  createTransfer(@Ctx() ctx: RequestContext, @Body(new ZodPipe(TreasuryTransferCreateSchema)) body: TreasuryTransferCreateInput) {
    return this.cashOps.createTransfer(ctx, body);
  }

  @Post('transfers/:id/void')
  @RequirePermissions('treasury.move')
  voidTransfer(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VoidSchema)) body: { reason: string }) {
    return this.cashOps.voidTransfer(ctx, id, body.reason);
  }

  @Get('accounts/:id/closing-preview')
  @RequirePermissions('treasury.view')
  closingPreview(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(PreviewQuerySchema)) query: { date?: string }) {
    return this.cashOps.closingPreview(ctx, id, query.date);
  }

  @Get('cash-closings')
  @RequirePermissions('treasury.view')
  listClosings(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ClosingQuerySchema)) query: z.infer<typeof ClosingQuerySchema>) {
    return this.cashOps.listClosings(ctx, query);
  }

  @Post('cash-closings')
  @RequirePermissions('treasury.move')
  createClosing(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CashClosingCreateSchema)) body: CashClosingCreateInput) {
    return this.cashOps.createClosing(ctx, body);
  }

  @Get('expenses')
  @RequirePermissions('treasury.view')
  listExpenses(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ExpenseQuerySchema)) query: ExpenseQuery) {
    return this.expenses.list(ctx, query);
  }

  @Post('expenses')
  @RequirePermissions('treasury.move')
  createExpense(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ExpenseCreateSchema)) body: ExpenseCreateInput) {
    return this.expenses.create(ctx, body);
  }

  @Get('expense-templates')
  @RequirePermissions('treasury.view')
  listExpenseTemplates(@Ctx() ctx: RequestContext) {
    return this.expenses.listTemplates(ctx);
  }

  @Post('expense-templates')
  @RequirePermissions('treasury.move')
  createExpenseTemplate(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ExpenseTemplateCreateSchema)) body: ExpenseTemplateCreateInput) {
    return this.expenses.createTemplate(ctx, body);
  }

  @Post('expense-templates/:id/register')
  @RequirePermissions('treasury.move')
  registerExpenseTemplate(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ExpenseTemplateRegisterSchema)) body: ExpenseTemplateRegisterInput,
  ) {
    return this.expenses.registerFromTemplate(ctx, id, body);
  }

  @Post('expense-templates/:id/deactivate')
  @RequirePermissions('treasury.move')
  deactivateExpenseTemplate(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.setTemplateActive(ctx, id, false);
  }

  @Post('expenses/:id/void')
  @RequirePermissions('treasury.move')
  voidExpense(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VoidSchema)) body: { reason: string }) {
    return this.expenses.void(ctx, id, body.reason);
  }

  @Get('statements')
  @RequirePermissions('treasury.view')
  listStatements(@Ctx() ctx: RequestContext, @Query(new ZodPipe(StatementQuerySchema)) query: { cashAccountId?: string }) {
    return this.statements.list(ctx, query.cashAccountId);
  }

  @Post('accounts/:id/statements')
  @RequirePermissions('treasury.move')
  importStatement(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(StatementImportSchema)) body: StatementImportInput) {
    return this.statements.import(ctx, id, body);
  }

  @Get('statements/:id')
  @RequirePermissions('treasury.view')
  statement(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.statements.detail(ctx, id);
  }

  @Post('statements/:id/auto-match')
  @RequirePermissions('treasury.move')
  autoMatch(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.statements.autoMatch(ctx, id);
  }

  @Post('statement-lines/:id/match')
  @RequirePermissions('treasury.move')
  matchLine(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(StatementLineMatchSchema)) body: StatementLineMatchInput) {
    return this.statements.match(ctx, id, body.movementId);
  }

  @Post('statement-lines/:id/create')
  @RequirePermissions('treasury.move')
  createFromLine(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(StatementLineCreateSchema)) body: StatementLineCreateInput) {
    return this.statements.create(ctx, id, body);
  }

  @Post('statement-lines/:id/ignore')
  @RequirePermissions('treasury.move')
  ignoreLine(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(StatementLineIgnoreSchema)) body: StatementLineIgnoreInput) {
    return this.statements.ignore(ctx, id, body.reason);
  }

  @Post('statement-lines/:id/undo')
  @RequirePermissions('treasury.move')
  undoLine(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.statements.undo(ctx, id);
  }
}
