import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  MissingTenantContextError,
  runWithTenant,
  TenantMismatchError,
  TenantRepository,
  withoutTenantScope,
} from '../src';
import { Invoice } from './helpers/entities';
import { createSeededInvoices } from './helpers/test-database';

/**
 * Writes that address an existing row by primary key: `save` of an entity with an id,
 * `remove`, `softRemove`, `recover`. TypeORM loads those rows by id only, so before 0.2.0
 * `save({ id, ... })` with another tenant's id overwrote that tenant's row.
 */
describe('writes to existing rows', () => {
  let dataSource: DataSource;
  let invoices: TenantRepository<Invoice>;
  let warn: jest.SpyInstance;

  const asAcme = <T>(callback: () => T): T => runWithTenant('acme', callback);
  const plain = () => dataSource.getRepository(Invoice);
  const byTitle = (title: string) => plain().findOneOrFail({ where: { title }, withDeleted: true });

  beforeEach(async () => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    ({ dataSource, invoices } = await createSeededInvoices());
  });

  afterEach(async () => {
    warn.mockRestore();
    await dataSource.destroy();
  });

  describe('save by primary key', () => {
    it("refuses to overwrite another tenant's row (TenantRepository)", async () => {
      const g1 = await byTitle('G1');
      const attempt = asAcme(() => invoices.save({ id: g1.id, title: 'hijacked' }));
      await expect(attempt).rejects.toBeInstanceOf(TenantMismatchError);
      await expect(attempt).rejects.toMatchObject({
        entityName: 'Invoice',
        operation: 'update',
        expectedTenantId: 'acme',
        actualTenantId: 'globex',
      });
      expect((await byTitle('G1')).tenantId).toBe('globex');
    });

    it("refuses to overwrite another tenant's row (plain repository)", async () => {
      const g1 = await byTitle('G1');
      await expect(
        asAcme(() => plain().save({ id: g1.id, status: 'void' })),
      ).rejects.toBeInstanceOf(TenantMismatchError);
      expect((await byTitle('G1')).status).toBe('open');
    });

    it('refuses a whole bulk save when one row belongs to another tenant', async () => {
      const a1 = await byTitle('A1');
      const g1 = await byTitle('G1');
      await expect(
        asAcme(() =>
          invoices.save([
            { id: a1.id, status: 'void' },
            { id: g1.id, status: 'void' },
          ]),
        ),
      ).rejects.toBeInstanceOf(TenantMismatchError);
      expect((await byTitle('A1')).status).toBe('open');
    });

    it('updates own rows as before', async () => {
      const a1 = await byTitle('A1');
      await asAcme(() => invoices.save({ id: a1.id, status: 'void' }));
      expect((await byTitle('A1')).status).toBe('void');
    });

    it('refuses to move an own row to another tenant', async () => {
      const a1 = await byTitle('A1');
      await expect(
        asAcme(() => invoices.save({ id: a1.id, tenantId: 'globex' })),
      ).rejects.toBeInstanceOf(TenantMismatchError);
      expect((await byTitle('A1')).tenantId).toBe('acme');
    });

    it('refuses to clear the tenant of an own row', async () => {
      const a1 = await byTitle('A1');
      await expect(
        asAcme(() => invoices.save({ id: a1.id, tenantId: null as unknown as string })),
      ).rejects.toBeInstanceOf(TenantMismatchError);
    });

    it('needs a tenant', async () => {
      const a1 = await byTitle('A1');
      await expect(plain().save({ id: a1.id, status: 'void' })).rejects.toBeInstanceOf(
        MissingTenantContextError,
      );
      await expect(invoices.save({ id: a1.id, status: 'void' })).rejects.toBeInstanceOf(
        MissingTenantContextError,
      );
    });

    it('allows crossing tenants inside withoutTenantScope', async () => {
      const g1 = await byTitle('G1');
      await asAcme(() =>
        withoutTenantScope('support fixes a globex invoice', () =>
          invoices.save({ id: g1.id, status: 'void' }),
        ),
      );
      expect((await byTitle('G1')).status).toBe('void');
    });
  });

  describe('remove, softRemove and recover', () => {
    it("refuses to remove another tenant's row, even from a crafted entity", async () => {
      const g1 = await byTitle('G1');
      // A caller claiming the row is acme's must not fool the check: the stored row decides.
      const crafted = Object.assign(new Invoice(), { ...g1, tenantId: 'acme' });
      await expect(asAcme(() => invoices.remove(crafted))).rejects.toBeInstanceOf(
        TenantMismatchError,
      );
      await expect(asAcme(() => plain().remove(crafted))).rejects.toBeInstanceOf(
        TenantMismatchError,
      );
      expect(await plain().countBy({ title: 'G1' })).toBe(1);
    });

    it('removes own rows', async () => {
      const a1 = await asAcme(() => invoices.findOneByOrFail({ title: 'A1' }));
      await asAcme(() => invoices.remove(a1));
      expect(await plain().countBy({ title: 'A1' })).toBe(0);
    });

    it("refuses to soft-remove another tenant's row", async () => {
      const g1 = await byTitle('G1');
      await expect(asAcme(() => invoices.softRemove(g1))).rejects.toBeInstanceOf(
        TenantMismatchError,
      );
      expect((await byTitle('G1')).deletedAt).toBeNull();
    });

    it('soft-removes and recovers own rows', async () => {
      const a1 = await asAcme(() => invoices.findOneByOrFail({ title: 'A1' }));
      await asAcme(() => invoices.softRemove(a1));
      expect((await byTitle('A1')).deletedAt).not.toBeNull();
      await asAcme(() => invoices.recover(a1));
      expect((await byTitle('A1')).deletedAt).toBeNull();
    });

    it("refuses to recover another tenant's row", async () => {
      const g1 = await byTitle('G1');
      await withoutTenantScope('test setup', () => plain().softRemove(g1));
      await expect(asAcme(() => invoices.recover(g1))).rejects.toBeInstanceOf(TenantMismatchError);
      expect((await byTitle('G1')).deletedAt).not.toBeNull();
    });

    it('needs a tenant', async () => {
      const a1 = await byTitle('A1');
      await expect(invoices.remove(a1)).rejects.toBeInstanceOf(MissingTenantContextError);
      await expect(invoices.softRemove(a1)).rejects.toBeInstanceOf(MissingTenantContextError);
      await expect(invoices.recover(a1)).rejects.toBeInstanceOf(MissingTenantContextError);
    });
  });

  describe('query-builder writes through plain repositories', () => {
    it('need a tenant instead of silently touching every tenant', async () => {
      await expect(plain().delete({ status: 'paid' })).rejects.toBeInstanceOf(
        MissingTenantContextError,
      );
      await expect(plain().update({ status: 'paid' }, { status: 'void' })).rejects.toBeInstanceOf(
        MissingTenantContextError,
      );
      expect(await plain().countBy({ status: 'paid' })).toBe(2);
    });

    it('cannot move rows to another tenant', async () => {
      await expect(
        asAcme(() => plain().update({ title: 'A1' }, { tenantId: 'globex' })),
      ).rejects.toBeInstanceOf(TenantMismatchError);
    });

    it('still work inside withoutTenantScope', async () => {
      await withoutTenantScope('cleanup job across tenants', () =>
        plain().delete({ status: 'paid' }),
      );
      expect(await plain().countBy({ status: 'paid' })).toBe(0);
    });
  });
});
