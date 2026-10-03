import { Body, Controller, Get, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectTenantRepository, TenantRepository } from 'nestjs-tenant-guard';
import { Invoice } from './invoice.entity';
import { Plan } from './plan.entity';

@Controller()
export class InvoicesController {
  constructor(
    // Scoped to the caller's tenant. No tenant condition appears anywhere below.
    @InjectTenantRepository(Invoice) private readonly invoices: TenantRepository<Invoice>,
    // A regular repository is fine for global entities.
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
  ) {}

  @Get('invoices')
  list(): Promise<Invoice[]> {
    return this.invoices.find({ order: { id: 'ASC' } });
  }

  @Post('invoices')
  create(@Body() body: { title: string }): Promise<Invoice> {
    return this.invoices.save({ title: body.title });
  }

  @Get('plans')
  listPlans(): Promise<Plan[]> {
    return this.plans.find();
  }
}
