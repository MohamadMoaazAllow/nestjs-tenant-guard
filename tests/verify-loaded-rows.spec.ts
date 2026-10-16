import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  createTenantRepository,
  registerTenantSubscriber,
  runWithTenant,
  TenantMismatchError,
  TenantRepository,
  withoutTenantScope,
} from '../src';
import { Invoice, Payment } from './helpers/entities';
import { createSeededInvoices } from './helpers/test-database';

/**
 * `verifyLoadedRows` checks every loaded row of a tenant-scoped entity. It is the safety net
 * for paths the repository cannot scope: relations, joins and plain repositories.
 */
describe('verifyLoadedRows', () => {
  let dataSource: DataSource;
  let invoices: TenantRepository<Invoice>;
  let warn: jest.SpyInstance;

  const asAcme = <T>(callback: () => T): T => runWithTenant('acme', callback);

  beforeEach(async () => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    ({ dataSource, invoices } = await createSeededInvoices());
    // Bad data on purpose: a globex payment attached to an acme invoice.
    const a1 = await dataSource.getRepository(Invoice).findOneByOrFail({ title: 'A1' });
    await withoutTenantScope('test setup', () =>
      dataSource.getRepository(Payment).save({ tenantId: 'globex', cents: 100, invoice: a1 }),
    );
  });

  afterEach(async () => {
    warn.mockRestore();
    await dataSource.destroy();
  });

  describe('off (default)', () => {
    it('lets a relation leak, as documented in the README', async () => {
      const a1 = await asAcme(() =>
        invoices.findOneOrFail({ where: { title: 'A1' }, relations: { payments: true } }),
      );
      expect(a1.payments.map((payment) => payment.tenantId)).toEqual(['globex']);
    });
  });

  describe('on', () => {
    beforeEach(() => {
      registerTenantSubscriber(dataSource, { verifyLoadedRows: true });
    });

    it('throws on a relation row of another tenant', async () => {
      const attempt = asAcme(() =>
        invoices.findOne({ where: { title: 'A1' }, relations: { payments: true } }),
      );
      await expect(attempt).rejects.toBeInstanceOf(TenantMismatchError);
      await expect(attempt).rejects.toMatchObject({
        entityName: 'Payment',
        operation: 'load',
        expectedTenantId: 'acme',
        actualTenantId: 'globex',
      });
    });

    it('throws on a query-builder join to a row of another tenant', async () => {
      await expect(
        asAcme(() =>
          invoices.createQueryBuilder('i').leftJoinAndSelect('i.payments', 'p').getMany(),
        ),
      ).rejects.toBeInstanceOf(TenantMismatchError);
    });

    it('throws when a plain repository reads other tenants inside a tenant context', async () => {
      await expect(asAcme(() => dataSource.getRepository(Invoice).find())).rejects.toBeInstanceOf(
        TenantMismatchError,
      );
    });

    it('lets clean reads through', async () => {
      const a2 = await asAcme(() =>
        invoices.findOneOrFail({ where: { title: 'A2' }, relations: { payments: true } }),
      );
      expect(a2.payments).toEqual([]);
      expect(await asAcme(() => invoices.count())).toBe(2);
      expect(await runWithTenant('globex', () => invoices.find())).toHaveLength(2);
    });

    it('skips partial selects without the tenant column', async () => {
      const rows = await asAcme(() =>
        dataSource.getRepository(Invoice).find({ select: { title: true } }),
      );
      expect(rows).toHaveLength(4);
    });

    it('does not check bypassed or tenant-less reads', async () => {
      expect(
        await withoutTenantScope('report', () => dataSource.getRepository(Invoice).find()),
      ).toHaveLength(4);
      expect(await dataSource.getRepository(Invoice).find()).toHaveLength(4);
    });

    it('can be switched off again', async () => {
      registerTenantSubscriber(dataSource, { verifyLoadedRows: false });
      expect(await asAcme(() => dataSource.getRepository(Invoice).find())).toHaveLength(4);
    });
  });

  it('works with a repository created after the subscriber was configured', async () => {
    registerTenantSubscriber(dataSource, { verifyLoadedRows: true });
    const payments = createTenantRepository(dataSource, Payment);
    expect(await runWithTenant('globex', () => payments.count())).toBe(1);
  });
});
