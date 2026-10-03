import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
  console.log('Try: curl -H "x-tenant-id: acme" -H "content-type: application/json" \\');
  console.log('       -d \'{"title":"first"}\' http://localhost:3000/invoices');
}

void bootstrap();
