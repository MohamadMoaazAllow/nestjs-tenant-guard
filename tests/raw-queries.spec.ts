import { DataSource } from 'typeorm';
import { runWithTenant } from '../src';
import { Invoice } from './helpers/entities';
import { createSeededInvoices } from './helpers/test-database';

/**
 * These tests document the library's limits. They assert the UNPROTECTED behaviour on
 * purpose: if one of them ever fails because the data became protected, the README's
 * "Limits" section needs updating too.
 */
describe('what is NOT protected', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    ({ dataSource } = await createSeededInvoices());
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it("dataSource.query returns every tenant's rows, even inside a tenant context", async () => {
    const rows = await runWithTenant('acme', () =>
      dataSource.query<{ title: string }[]>('SELECT title FROM invoice ORDER BY title'),
    );
    expect(rows.map((row) => row.title)).toEqual(['A1', 'A2', 'G1', 'G2']);
  });

  it("manager.query returns every tenant's rows too", async () => {
    const rows = await runWithTenant('acme', () =>
      dataSource.manager.query<{ n: number }[]>('SELECT COUNT(*) AS n FROM invoice'),
    );
    expect(rows[0]?.n).toBe(4);
  });

  it('raw queries can write across tenants without any error', async () => {
    await runWithTenant('acme', () =>
      dataSource.query("UPDATE invoice SET status = 'void' WHERE title = 'G1'"),
    );
    const row = await dataSource.getRepository(Invoice).findOneByOrFail({ title: 'G1' });
    expect(row.status).toBe('void');
  });

  it('a plain TypeORM repository is not scoped, only repositories from this library are', async () => {
    const rows = await runWithTenant('acme', () => dataSource.getRepository(Invoice).find());
    expect(rows).toHaveLength(4);
  });

  it('save() of an entity with an existing primary key is not tenant-checked', async () => {
    const globexRow = await dataSource.getRepository(Invoice).findOneByOrFail({ title: 'G1' });
    await runWithTenant('acme', () =>
      dataSource.getRepository(Invoice).save({ id: globexRow.id, status: 'void' }),
    );
    const after = await dataSource.getRepository(Invoice).findOneByOrFail({ id: globexRow.id });
    expect(after.status).toBe('void');
  });
});
