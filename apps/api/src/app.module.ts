import { Controller, Get, Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PrismaService } from './prisma/prisma.service';
import { UnitOfWork } from './common/unit-of-work';
import { AuditService, NumberingService } from './common/common.service';
import { ErrorFilter } from './common/error.filter';
import { Public } from './common/decorators';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthController } from './auth/auth.controller';
import { SettingsService } from './settings/settings.service';
import { SettingsController } from './settings/settings.controller';
import { PartiesService } from './parties/parties.service';
import { PartiesController } from './parties/parties.controller';
import { CatalogService } from './catalog/catalog.service';
import { CatalogController } from './catalog/catalog.controller';
import { MaterialsController, MaterialsService } from './materials/materials.service';
import { StockService } from './inventory/stock.service';
import { StockDocumentsService } from './inventory/stock-documents.service';
import { InventoryQueryService } from './inventory/inventory-query.service';
import { InventoryController } from './inventory/inventory.controller';
import { UsersController, UsersService } from './users/users.module';
import { SearchController } from './search/search.controller';
import { AccountsController, AccountsService } from './accounts/accounts.service';
import { PurchasingService } from './purchasing/purchasing.service';
import { PurchasingController } from './purchasing/purchasing.controller';
import { ProductionService } from './production/production.service';
import { ProductionConfigService } from './production/production-config.service';
import { TechSheetsService } from './production/techsheets.service';
import { SettlementsService } from './production/settlements.service';
import { ProductionController } from './production/production.controller';
import { AllocationsService } from './accounts/allocations.service';
import { CommissionsService } from './sales/commissions.service';
import { PricingService } from './sales/pricing.service';
import { PromotionsService } from './sales/promotions.service';
import { SalesOrdersService } from './sales/sales-orders.service';
import { DeliveriesService } from './sales/deliveries.service';
import { ArcaService } from './sales/arca.service';
import { SalesInvoicesService } from './sales/sales-invoices.service';
import { ReceiptsService } from './sales/receipts.service';
import { SalesController } from './sales/sales.controller';
import { TreasuryController } from './treasury/treasury.controller';
import { TreasuryService } from './treasury/treasury.service';
import { ChequesService } from './treasury/cheques.service';
import { SupplierPaymentsService } from './treasury/supplier-payments.service';
import { CashOperationsService } from './treasury/cash-operations.service';
import { ExpensesService } from './treasury/expenses.service';
import { StatementsService } from './treasury/statements.service';
import { CashflowService } from './treasury/cashflow.service';
import { PeriodsController } from './periods/periods.controller';
import { PeriodsService } from './periods/periods.service';
import { ReportsController } from './reports/reports.controller';
import { ExecutiveService } from './reports/executive.service';
import { ProfitabilityService } from './reports/profitability.service';
import { ReportsCenterService } from './reports/reports-center.service';
import { AlertsController } from './alerts/alerts.controller';
import { AlertsService } from './alerts/alerts.service';
import { AlertsScheduler } from './alerts/alerts.scheduler';
import { EmailDispatcher } from './alerts/email-dispatcher';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}

/** Plataforma compartida por todos los módulos de dominio. */
@Global()
@Module({
  providers: [PrismaService, UnitOfWork, AuditService, NumberingService],
  exports: [PrismaService, UnitOfWork, AuditService, NumberingService],
})
class PlatformModule {}

@Module({ providers: [StockService], exports: [StockService] })
export class StockModule {}

@Module({
  imports: [PlatformModule, StockModule],
  controllers: [
    HealthController,
    AuthController,
    SettingsController,
    PartiesController,
    CatalogController,
    MaterialsController,
    InventoryController,
    UsersController,
    SearchController,
    AccountsController,
    PurchasingController,
    ProductionController,
    SalesController,
    TreasuryController,
    PeriodsController,
    ReportsController,
    AlertsController,
  ],
  providers: [
    AuthService,
    SettingsService,
    PartiesService,
    CatalogService,
    MaterialsService,
    StockDocumentsService,
    InventoryQueryService,
    UsersService,
    AccountsService,
    PurchasingService,
    ProductionService,
    ProductionConfigService,
    TechSheetsService,
    SettlementsService,
    AllocationsService,
    CommissionsService,
    PricingService,
    PromotionsService,
    SalesOrdersService,
    DeliveriesService,
    ArcaService,
    SalesInvoicesService,
    ReceiptsService,
    TreasuryService,
    ChequesService,
    SupplierPaymentsService,
    CashOperationsService,
    ExpensesService,
    StatementsService,
    CashflowService,
    PeriodsService,
    ExecutiveService,
    ProfitabilityService,
    ReportsCenterService,
    AlertsService,
    EmailDispatcher,
    AlertsScheduler,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
