import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  MissingTenantContextError,
  registerTenantSubscriber,
  runWithTenant,
  TenantMismatchError,
  withoutTenantScope,
} from '../src';
import { Country, Invoice, Note } from './helpers/entities';
import { createTestDataSource } from './helpers/test-database';

describe('TenantSubscriber', () => {
  let dataSource: DataSource;
  let warn: jest.SpyInstance;

  // Plain TypeORM repositories on purpose: the subscriber protects inserts on any path.
  const invoices = () => dataSource.getRepository(Invoice);
  const asAcme = <T>(callback: () => T): T => runWithTenant('acme', callback);

  beforeEach(async () => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    dataSource = await createTestDataSource();
  });

  afterEach(async () => {
    warn.mockRestore();
    await dataSource.destroy();
  });

  describe('stamping', () => {
    it('stamps the tenant on save', async () => {
      const saved = await asAcme(() => invoices().save({ title: 'A1' }));
      expect(saved.tenantId).toBe('acme');
      expect(await invoices().findOneByOrFail({ id: saved.id })).toMatchObject({
        tenantId: 'acme',
      });
    });

    it('stamps every entity of a bulk save', async () => {
      const saved = await asAcme(() => invoices().save([{ title: 'A1' }, { title: 'A2' }]));
      expect(saved.map((row) => row.tenantId)).toEqual(['acme', 'acme']);
    });

    it('stamps the tenant on repository.insert', async () => {
      const result = await asAcme(() => invoices().insert({ title: 'A1' }));
      const row = await invoices().findOneByOrFail({ id: result.identifiers[0]?.id as number });
      expect(row.tenantId).toBe('acme');
    });

    it('stamps the tenant on a query builder insert', async () => {
      await asAcme(() =>
        dataSource.createQueryBuilder().insert().into(Invoice).values({ title: 'A1' }).execute(),
      );
      expect(await invoices().findOneByOrFail({ title: 'A1' })).toMatchObject({
        tenantId: 'acme',
      });
    });

    it('stamps a null tenant column', async () => {
      const saved = await asAcme(() =>
        invoices().save({ title: 'A1', tenantId: null as unknown as string }),
      );
      expect(saved.tenantId).toBe('acme');
    });

    it('accepts a row that already names the current tenant', async () => {
      const saved = await asAcme(() => invoices().save({ title: 'A1', tenantId: 'acme' }));
      expect(saved.tenantId).toBe('acme');
    });

    it('uses the column configured on the decorator', async () => {
      const note = await asAcme(() => dataSource.getRepository(Note).save({ text: 'hello' }));
      expect(note.orgId).toBe('acme');
    });
  });

  describe('validation', () => {
    it('throws TenantMismatchError for a row of another tenant (save)', async () => {
      const attempt = asAcme(() => invoices().save({ title: 'X', tenantId: 'globex' }));
      await expect(attempt).rejects.toBeInstanceOf(TenantMismatchError);
      await expect(attempt).rejects.toMatchObject({
        entityName: 'Invoice',
        operation: 'insert',
        expectedTenantId: 'acme',
        actualTenantId: 'globex',
      });
      expect(await invoices().count()).toBe(0);
    });

    it('throws TenantMismatchError for a row of another tenant (insert)', async () => {
      await expect(
        asAcme(() => invoices().insert({ title: 'X', tenantId: 'globex' })),
      ).rejects.toBeInstanceOf(TenantMismatchError);
    });

    it('throws MissingTenantContextError when no tenant is known', async () => {
      await expect(invoices().save({ title: 'X' })).rejects.toBeInstanceOf(
        MissingTenantContextError,
      );
      expect(await invoices().count()).toBe(0);
    });

    it('lets one bad row abort a whole bulk save', async () => {
      await expect(
        asAcme(() => invoices().save([{ title: 'ok' }, { title: 'bad', tenantId: 'globex' }])),
      ).rejects.toBeInstanceOf(TenantMismatchError);
      expect(await invoices().count()).toBe(0);
    });
  });

  describe('bypass', () => {
    it('neither stamps nor validates inside withoutTenantScope', async () => {
      await withoutTenantScope('import data of several tenants', async () => {
        await invoices().save({ title: 'X', tenantId: 'globex' });
        await asAcme(async () => undefined);
      });
      expect(await invoices().findOneByOrFail({ title: 'X' })).toMatchObject({
        tenantId: 'globex',
      });
      expect(warn).toHaveBeenCalledWith('Tenant scope bypassed: import data of several tenants');
    });
  });

  describe('global entities', () => {
    it('are never touched', async () => {
      const country = await dataSource.getRepository(Country).save({ name: 'Norway' });
      expect(country.name).toBe('Norway');
      await asAcme(() => dataSource.getRepository(Country).save({ name: 'Sweden' }));
      expect(await dataSource.getRepository(Country).count()).toBe(2);
    });
  });

  describe('registerTenantSubscriber', () => {
    it('does not register a second subscriber', () => {
      const first = registerTenantSubscriber(dataSource);
      const second = registerTenantSubscriber(dataSource);
      expect(second).toBe(first);
      expect(dataSource.subscribers.filter((s) => s === first)).toHaveLength(1);
    });
  });
});
