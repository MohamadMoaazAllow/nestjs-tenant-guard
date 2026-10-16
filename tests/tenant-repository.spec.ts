import { Logger } from '@nestjs/common';
import { DataSource, EntityNotFoundError } from 'typeorm';
import {
  MissingTenantContextError,
  runWithTenant,
  TenantMismatchError,
  TenantRepository,
  withoutTenantScope,
} from '../src';
import { Invoice } from './helpers/entities';
import { createSeededInvoices, titles } from './helpers/test-database';

describe('TenantRepository', () => {
  let dataSource: DataSource;
  let invoices: TenantRepository<Invoice>;
  let warn: jest.SpyInstance;

  const asAcme = <T>(callback: () => T): T => runWithTenant('acme', callback);
  const asGlobex = <T>(callback: () => T): T => runWithTenant('globex', callback);

  beforeEach(async () => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    ({ dataSource, invoices } = await createSeededInvoices());
  });

  afterEach(async () => {
    warn.mockRestore();
    await dataSource.destroy();
  });

  describe('reads only return the current tenant', () => {
    it('find', async () => {
      expect(titles(await asAcme(() => invoices.find()))).toEqual(['A1', 'A2']);
      expect(titles(await asAcme(() => invoices.find({ where: { status: 'open' } })))).toEqual([
        'A1',
      ]);
    });

    it('find keeps the other find options working', async () => {
      const rows = await asAcme(() => invoices.find({ order: { title: 'DESC' }, take: 1 }));
      expect(rows.map((row) => row.title)).toEqual(['A2']);
    });

    it('findBy', async () => {
      expect(titles(await asGlobex(() => invoices.findBy({ status: 'paid' })))).toEqual(['G2']);
    });

    it('findAndCount', async () => {
      const [rows, total] = await asAcme(() => invoices.findAndCount());
      expect(titles(rows)).toEqual(['A1', 'A2']);
      expect(total).toBe(2);
    });

    it('findAndCountBy', async () => {
      const [rows, total] = await asAcme(() => invoices.findAndCountBy({ status: 'open' }));
      expect(titles(rows)).toEqual(['A1']);
      expect(total).toBe(1);
    });

    it('findOne', async () => {
      expect((await asAcme(() => invoices.findOne({ where: { title: 'A1' } })))?.title).toBe('A1');
      expect(await asAcme(() => invoices.findOne({ where: { title: 'G1' } }))).toBeNull();
    });

    it('findOneBy', async () => {
      expect((await asAcme(() => invoices.findOneBy({ title: 'A2' })))?.title).toBe('A2');
      expect(await asAcme(() => invoices.findOneBy({ title: 'G2' }))).toBeNull();
    });

    it('findOneOrFail', async () => {
      await expect(
        asAcme(() => invoices.findOneOrFail({ where: { title: 'A1' } })),
      ).resolves.toBeDefined();
      await expect(
        asAcme(() => invoices.findOneOrFail({ where: { title: 'G1' } })),
      ).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it('findOneByOrFail', async () => {
      await expect(asAcme(() => invoices.findOneByOrFail({ title: 'A1' }))).resolves.toBeDefined();
      await expect(asAcme(() => invoices.findOneByOrFail({ title: 'G1' }))).rejects.toBeInstanceOf(
        EntityNotFoundError,
      );
    });

    it('count and countBy', async () => {
      expect(await asAcme(() => invoices.count())).toBe(2);
      expect(await asGlobex(() => invoices.countBy({ status: 'open' }))).toBe(1);
    });

    it('exists and existsBy', async () => {
      expect(await asAcme(() => invoices.exists({ where: { title: 'A1' } }))).toBe(true);
      expect(await asAcme(() => invoices.exists({ where: { title: 'G1' } }))).toBe(false);
      expect(await asAcme(() => invoices.existsBy({ title: 'G1' }))).toBe(false);
      expect(await asGlobex(() => invoices.existsBy({ title: 'G1' }))).toBe(true);
    });
  });

  describe('OR where clauses', () => {
    it('applies the tenant to every branch of find', async () => {
      const rows = await asAcme(() => invoices.find({ where: [{ title: 'A1' }, { title: 'G1' }] }));
      expect(titles(rows)).toEqual(['A1']);
    });

    it('applies the tenant to every branch of findBy, count and exists', async () => {
      const branches = [{ status: 'open' }, { status: 'paid' }];
      expect(titles(await asAcme(() => invoices.findBy(branches)))).toEqual(['A1', 'A2']);
      expect(await asAcme(() => invoices.countBy(branches))).toBe(2);
      expect(await asAcme(() => invoices.existsBy([{ title: 'G1' }, { title: 'G2' }]))).toBe(false);
    });

    it('treats an empty array as "this tenant" rather than "everything"', async () => {
      expect(titles(await asAcme(() => invoices.find({ where: [] })))).toEqual(['A1', 'A2']);
      expect(titles(await asAcme(() => invoices.findBy([])))).toEqual(['A1', 'A2']);
    });

    it('applies the tenant to every branch of update and delete', async () => {
      const branches = [{ title: 'A1' }, { title: 'G1' }];
      expect((await asAcme(() => invoices.update(branches, { status: 'void' }))).affected).toBe(1);
      expect((await asAcme(() => invoices.delete(branches))).affected).toBe(1);
      expect(titles(await asGlobex(() => invoices.find()))).toEqual(['G1', 'G2']);
    });
  });

  describe('writes only touch the current tenant', () => {
    it('update', async () => {
      const result = await asAcme(() => invoices.update({ status: 'open' }, { status: 'void' }));
      expect(result.affected).toBe(1);
      expect(titles(await asGlobex(() => invoices.findBy({ status: 'open' })))).toEqual(['G1']);
      expect(titles(await asAcme(() => invoices.findBy({ status: 'void' })))).toEqual(['A1']);
    });

    it('update cannot hit a row of another tenant by its primary key', async () => {
      const globexRow = await asGlobex(() => invoices.findOneByOrFail({ title: 'G1' }));
      const result = await asAcme(() => invoices.update({ id: globexRow.id }, { status: 'void' }));
      expect(result.affected).toBe(0);
    });

    it('update refuses to move a row to another tenant', async () => {
      await expect(
        asAcme(() => invoices.update({ title: 'A1' }, { tenantId: 'globex' })),
      ).rejects.toBeInstanceOf(TenantMismatchError);
    });

    it('delete', async () => {
      const result = await asAcme(() => invoices.delete({ status: 'open' }));
      expect(result.affected).toBe(1);
      expect(await asGlobex(() => invoices.count())).toBe(2);
      expect(titles(await asAcme(() => invoices.find()))).toEqual(['A2']);
    });

    it('softDelete and restore', async () => {
      expect((await asAcme(() => invoices.softDelete({ status: 'open' }))).affected).toBe(1);
      expect(await asAcme(() => invoices.count())).toBe(1);
      expect(await asGlobex(() => invoices.count())).toBe(2);

      // Another tenant's restore must not bring the row back.
      expect((await asGlobex(() => invoices.restore({ title: 'A1' }))).affected).toBe(0);
      expect(await asAcme(() => invoices.count())).toBe(1);

      expect((await asAcme(() => invoices.restore({ title: 'A1' }))).affected).toBe(1);
      expect(await asAcme(() => invoices.count())).toBe(2);
    });
  });

  describe('createQueryBuilder', () => {
    it('adds the tenant to a plain where', async () => {
      const rows = await asAcme(() =>
        invoices.createQueryBuilder('i').where('i.status = :status', { status: 'open' }).getMany(),
      );
      expect(titles(rows)).toEqual(['A1']);
    });

    it('survives a where() call that comes after other conditions', async () => {
      const rows = await asAcme(() =>
        invoices
          .createQueryBuilder('i')
          .where('i.title = :first', { first: 'G1' })
          .where('i.status = :status', { status: 'open' })
          .getMany(),
      );
      expect(titles(rows)).toEqual(['A1']);
    });

    it('applies the tenant to the whole OR expression, not just its last term', async () => {
      const rows = await asAcme(() =>
        invoices
          .createQueryBuilder('i')
          .where('i.title = :a', { a: 'A1' })
          .orWhere('i.title = :g', { g: 'G1' })
          .orWhere('i.title = :g2', { g2: 'G2' })
          .getMany(),
      );
      expect(titles(rows)).toEqual(['A1']);
    });

    it('works with getCount and getRawMany', async () => {
      expect(await asAcme(() => invoices.createQueryBuilder('i').getCount())).toBe(2);
      const raw = await asGlobex(() =>
        invoices.createQueryBuilder('i').select('i.title', 'title').getRawMany<{ title: string }>(),
      );
      expect(titles(raw)).toEqual(['G1', 'G2']);
    });

    it('fails loudly, instead of dropping the condition, when turned into an update or delete', async () => {
      // The tenant condition is written for a SELECT. UPDATE/DELETE builders resolve column
      // names differently, so TypeORM rejects the statement. That is the safe outcome; the
      // README tells users to call repository.update()/delete() instead.
      // Matched by message, not with toThrow(): better-sqlite3 is a native module loaded once
      // per worker, so its SqliteError can come from another test file's realm and then fail
      // `instanceof Error`, which toThrow() relies on.
      const sqlError = { message: expect.stringContaining('tenantId') };
      await expect(
        asAcme(() =>
          invoices
            .createQueryBuilder('i')
            .update()
            .set({ status: 'void' })
            .where('1 = 1')
            .execute(),
        ),
      ).rejects.toMatchObject(sqlError);
      await expect(
        asAcme(() => invoices.createQueryBuilder('i').delete().where('1 = 1').execute()),
      ).rejects.toMatchObject(sqlError);
      expect(await asGlobex(() => invoices.count())).toBe(2);
      expect(await asAcme(() => invoices.count())).toBe(2);
    });

    it('survives a clone', async () => {
      const builder = await asAcme(() => invoices.createQueryBuilder('i'));
      expect(await builder.clone().getCount()).toBe(2);
    });

    it('throws synchronously without a tenant', () => {
      expect(() => invoices.createQueryBuilder('i')).toThrow(MissingTenantContextError);
    });
  });

  describe('without a tenant in context', () => {
    const calls: [string, (repo: TenantRepository<Invoice>) => Promise<unknown>][] = [
      ['find', (repo) => repo.find()],
      ['findBy', (repo) => repo.findBy({ status: 'open' })],
      ['findAndCount', (repo) => repo.findAndCount()],
      ['findAndCountBy', (repo) => repo.findAndCountBy({ status: 'open' })],
      ['findOne', (repo) => repo.findOne({ where: { title: 'A1' } })],
      ['findOneBy', (repo) => repo.findOneBy({ title: 'A1' })],
      ['findOneOrFail', (repo) => repo.findOneOrFail({ where: { title: 'A1' } })],
      ['findOneByOrFail', (repo) => repo.findOneByOrFail({ title: 'A1' })],
      ['count', (repo) => repo.count()],
      ['countBy', (repo) => repo.countBy({ status: 'open' })],
      ['exists', (repo) => repo.exists()],
      ['existsBy', (repo) => repo.existsBy({ status: 'open' })],
      ['update', (repo) => repo.update({ status: 'open' }, { status: 'void' })],
      ['delete', (repo) => repo.delete({ status: 'open' })],
      ['softDelete', (repo) => repo.softDelete({ status: 'open' })],
      ['restore', (repo) => repo.restore({ status: 'open' })],
      ['save', (repo) => repo.save({ title: 'X' })],
      ['insert', (repo) => repo.insert({ title: 'X' })],
    ];

    it.each(calls)('%s rejects with MissingTenantContextError', async (operation, call) => {
      const promise = call(invoices);
      await expect(promise).rejects.toBeInstanceOf(MissingTenantContextError);
      await expect(promise).rejects.toMatchObject({ entityName: 'Invoice' });
      if (operation !== 'save' && operation !== 'insert') {
        await expect(promise).rejects.toMatchObject({ operation });
      }
    });

    it('never falls back to returning all rows', async () => {
      await expect(invoices.find()).rejects.toThrow(/No tenant in the current context/);
    });
  });

  describe('withoutTenantScope', () => {
    it('returns rows of all tenants and logs the reason', async () => {
      const rows = await withoutTenantScope('nightly billing job across all tenants', () =>
        invoices.find(),
      );
      expect(titles(rows)).toEqual(['A1', 'A2', 'G1', 'G2']);
      expect(warn).toHaveBeenCalledWith(
        'Tenant scope bypassed: nightly billing job across all tenants',
      );
    });

    it('also lifts scoping inside an existing tenant context', async () => {
      const count = await asAcme(() =>
        withoutTenantScope('support lookup', () => invoices.count()),
      );
      expect(count).toBe(4);
    });

    it('applies to every kind of operation', async () => {
      await withoutTenantScope('maintenance', async () => {
        expect(await invoices.countBy({ status: 'open' })).toBe(2);
        expect((await invoices.update({ status: 'open' }, { status: 'void' })).affected).toBe(2);
        expect(await invoices.createQueryBuilder('i').getCount()).toBe(4);
        expect((await invoices.delete({ status: 'void' })).affected).toBe(2);
      });
    });
  });

  describe('withManager', () => {
    it('runs inside the given transaction and stays scoped', async () => {
      await expect(
        asAcme(() =>
          dataSource.transaction(async (manager) => {
            const inTransaction = invoices.withManager(manager);
            await inTransaction.save({ title: 'A3' });
            expect(titles(await inTransaction.find())).toEqual(['A1', 'A2', 'A3']);
            throw new Error('roll back');
          }),
        ),
      ).rejects.toThrow('roll back');

      expect(titles(await asAcme(() => invoices.find()))).toEqual(['A1', 'A2']);
    });
  });

  describe('explicit tenant filters', () => {
    it('throws when a where names another tenant', async () => {
      await expect(
        asAcme(() => invoices.find({ where: { tenantId: 'globex' } })),
      ).rejects.toBeInstanceOf(TenantMismatchError);
    });

    it('accepts a where naming the current tenant', async () => {
      expect(titles(await asAcme(() => invoices.findBy({ tenantId: 'acme' })))).toEqual([
        'A1',
        'A2',
      ]);
    });
  });
});
