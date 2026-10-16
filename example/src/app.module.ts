import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantGuardModule } from 'nestjs-tenant-guard';
import { Invoice } from './invoice.entity';
import { InvoicesController } from './invoices.controller';
import { Plan } from './plan.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Invoice, Plan],
      synchronize: true,
    }),
    // Reads the tenant from the `x-tenant-id` header. In production, only accept that
    // header from a trusted gateway, or resolve the tenant from a verified JWT instead
    // (see jwt-tenant.resolver.ts).
    // verifyLoadedRows: also fail loudly if a join or relation ever returns another tenant's row.
    TenantGuardModule.forRoot({ header: 'x-tenant-id', verifyLoadedRows: true }),
    TenantGuardModule.forFeature([Invoice]),
    TypeOrmModule.forFeature([Plan]),
  ],
  controllers: [InvoicesController],
})
export class AppModule {}
