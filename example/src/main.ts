import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MissingTenantFilter, TenantMismatchFilter } from './tenant-errors.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new TenantMismatchFilter(), new MissingTenantFilter());
  await app.listen(3000);
  console.log('Try: curl -H "x-tenant-id: acme" -H "content-type: application/json" \\');
  console.log('       -d \'{"title":"first"}\' http://localhost:3000/invoices');
}

void bootstrap();
