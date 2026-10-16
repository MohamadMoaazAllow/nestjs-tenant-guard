import { DataSource } from 'typeorm';
import {
  createTenantRepository,
  runWithTenant,
  TenantRepository,
  TenantSubscriber,
} from '../../src';
import { Country, Invoice, Note, Payment } from './entities';

/** Fresh in-memory SQLite database with the insert subscriber registered. */
export async function createTestDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [Invoice, Note, Country, Payment],
    subscribers: [TenantSubscriber],
    synchronize: true,
  });
  return dataSource.initialize();
}

/**
 * Two tenants, two invoices each:
 * acme: A1 (open), A2 (paid); globex: G1 (open), G2 (paid).
 */
export async function seedInvoices(invoices: TenantRepository<Invoice>): Promise<void> {
  await runWithTenant('acme', () =>
    invoices.save([
      { title: 'A1', status: 'open' },
      { title: 'A2', status: 'paid' },
    ]),
  );
  await runWithTenant('globex', () =>
    invoices.save([
      { title: 'G1', status: 'open' },
      { title: 'G2', status: 'paid' },
    ]),
  );
}

/** Shorthand used by most specs: a ready database plus a seeded tenant-aware repository. */
export async function createSeededInvoices(): Promise<{
  dataSource: DataSource;
  invoices: TenantRepository<Invoice>;
}> {
  const dataSource = await createTestDataSource();
  const invoices = createTenantRepository(dataSource, Invoice);
  await seedInvoices(invoices);
  return { dataSource, invoices };
}

/** Sorted titles, so assertions do not depend on row order. */
export function titles(rows: readonly { title: string }[]): string[] {
  return rows.map((row) => row.title).sort();
}
