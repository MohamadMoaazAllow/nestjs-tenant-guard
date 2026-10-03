import { Controller, Get, INestApplication, Injectable, Module, Post, Body } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import {
  InjectTenantRepository,
  TenantGuardModule,
  TenantRepository,
  TenantRequest,
  TenantResolver,
} from '../src';
import { Country, Invoice } from './helpers/entities';

@Injectable()
class InvoiceService {
  constructor(@InjectTenantRepository(Invoice) readonly invoices: TenantRepository<Invoice>) {}
}

@Controller()
class AppController {
  constructor(
    private readonly service: InvoiceService,
    @InjectRepository(Country) private readonly countries: Repository<Country>,
  ) {}

  @Get('invoices')
  async list(): Promise<string[]> {
    const rows = await this.service.invoices.find({ order: { title: 'ASC' } });
    return rows.map((row) => row.title);
  }

  @Post('invoices')
  async create(@Body() body: { title: string }): Promise<{ tenantId: string }> {
    const saved = await this.service.invoices.save({ title: body.title });
    return { tenantId: saved.tenantId };
  }

  @Get('slow-invoices')
  async slowList(): Promise<string[]> {
    // Yield a few times so concurrent requests interleave inside the handler.
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return this.list();
  }

  @Get('countries')
  async listCountries(): Promise<number> {
    return this.countries.count();
  }
}

@Module({
  imports: [TenantGuardModule.forFeature([Invoice]), TypeOrmModule.forFeature([Country])],
  controllers: [AppController],
  providers: [InvoiceService],
})
class FeatureModule {}

const databaseModule = TypeOrmModule.forRoot({
  type: 'better-sqlite3',
  database: ':memory:',
  entities: [Invoice, Country],
  synchronize: true,
});

async function createApp(
  guard: ReturnType<typeof TenantGuardModule.forRoot>,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [databaseModule, guard, FeatureModule],
  }).compile();
  // Silenced: the missing-tenant test triggers an expected 500 that Nest would log loudly.
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

describe('TenantGuardModule', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  describe('forRoot with the default header resolver', () => {
    beforeEach(async () => {
      app = await createApp(TenantGuardModule.forRoot());
    });

    const post = (tenant: string, title: string) =>
      request(app.getHttpServer()).post('/invoices').set('x-tenant-id', tenant).send({ title });
    const list = (tenant: string, path = '/invoices') =>
      request(app.getHttpServer()).get(path).set('x-tenant-id', tenant);

    it('stamps and scopes by the tenant header', async () => {
      const created = await post('acme', 'A1');
      expect(created.status).toBe(201);
      expect(created.body).toEqual({ tenantId: 'acme' });
      await post('globex', 'G1');

      expect((await list('acme')).body).toEqual(['A1']);
      expect((await list('globex')).body).toEqual(['G1']);
    });

    it('keeps concurrent HTTP requests of different tenants apart', async () => {
      await Promise.all([post('acme', 'A1'), post('acme', 'A2'), post('globex', 'G1')]);

      const responses = await Promise.all([
        list('acme', '/slow-invoices'),
        list('globex', '/slow-invoices'),
        list('acme', '/slow-invoices'),
        list('globex', '/slow-invoices'),
      ]);
      expect(responses.map((response) => response.body)).toEqual([
        ['A1', 'A2'],
        ['G1'],
        ['A1', 'A2'],
        ['G1'],
      ]);
    });

    it('fails a scoped query when the request has no tenant', async () => {
      const response = await request(app.getHttpServer()).get('/invoices');
      expect(response.status).toBe(500);
    });

    it('still serves global entities without a tenant', async () => {
      const response = await request(app.getHttpServer()).get('/countries');
      expect(response.status).toBe(200);
    });
  });

  describe('forRootAsync', () => {
    it('supports a custom header built by a factory', async () => {
      app = await createApp(
        TenantGuardModule.forRootAsync({ useFactory: () => ({ header: 'x-org' }) }),
      );
      await request(app.getHttpServer())
        .post('/invoices')
        .set('x-org', 'acme')
        .send({ title: 'A1' });

      const hit = await request(app.getHttpServer()).get('/invoices').set('x-org', 'acme');
      expect(hit.body).toEqual(['A1']);
      // The default header must not be read once another one is configured.
      const miss = await request(app.getHttpServer()).get('/invoices').set('x-tenant-id', 'acme');
      expect(miss.status).toBe(500);
    });

    it('supports a custom async resolver, e.g. one that verifies a token', async () => {
      const tokenResolver: TenantResolver = {
        async resolve(req: TenantRequest) {
          const token = req.headers.authorization;
          return typeof token === 'string' && token.startsWith('Bearer tenant:')
            ? token.slice('Bearer tenant:'.length)
            : undefined;
        },
      };
      app = await createApp(
        TenantGuardModule.forRootAsync({ useFactory: () => ({ resolver: tokenResolver }) }),
      );

      await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', 'Bearer tenant:acme')
        .send({ title: 'A1' });
      const response = await request(app.getHttpServer())
        .get('/invoices')
        .set('Authorization', 'Bearer tenant:acme');
      expect(response.body).toEqual(['A1']);
    });

    it('forwards resolver errors to Nest instead of hanging the request', async () => {
      const failing: TenantResolver = {
        resolve() {
          throw new Error('token verification failed');
        },
      };
      app = await createApp(TenantGuardModule.forRoot({ resolver: failing }));

      const response = await request(app.getHttpServer()).get('/countries');
      expect(response.status).toBe(500);
    });
  });
});
