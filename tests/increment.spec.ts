import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  MissingTenantContextError,
  runWithTenant,
  TenantRepository,
  withoutTenantScope,
} from '../src';
import { Invoice } from './helpers/entities';
import { createSeededInvoices } from './helpers/test-database';

describe('TenantRepository increment / decrement', () => {
  let dataSource: DataSource;
  let invoices: TenantRepository<Invoice>;
  let warn: jest.SpyInstance;

  const asAcme = <T>(callback: () => T): T => runWithTenant('acme', callback);
  const amounts = async () => {
    const rows = await dataSource.getRepository(Invoice).find({ order: { title: 'ASC' } });
    return Object.fromEntries(rows.map((row) => [row.title, row.amount]));
  };

  beforeEach(async () => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    ({ dataSource, invoices } = await createSeededInvoices());
  });

  afterEach(async () => {
    warn.mockRestore();
    await dataSource.destroy();
  });

  it('only changes rows of the current tenant', async () => {
    const result = await asAcme(() => invoices.increment({}, 'amount', 5));
    expect(result.affected).toBe(2);
    expect(await amounts()).toEqual({ A1: 5, A2: 5, G1: 0, G2: 0 });
  });

  it('respects the criteria, including OR branches', async () => {
    await asAcme(() => invoices.increment([{ title: 'A1' }, { title: 'G1' }], 'amount', 3));
    await asAcme(() => invoices.decrement({ title: 'A1' }, 'amount', '1'));
    expect(await amounts()).toEqual({ A1: 2, A2: 0, G1: 0, G2: 0 });
  });

  it('refuses the tenant column, unknown columns and non-numeric values', async () => {
    await expect(asAcme(() => invoices.increment({}, 'tenantId', 1))).rejects.toThrow(
      'tenant column',
    );
    await expect(asAcme(() => invoices.increment({}, 'nope', 1))).rejects.toThrow('no column');
    await expect(
      asAcme(() => invoices.increment({}, 'amount', '1; DROP TABLE invoice')),
    ).rejects.toThrow('finite number');
    await expect(asAcme(() => invoices.increment({}, 'amount', Number.NaN))).rejects.toThrow(
      'finite number',
    );
  });

  it('needs a tenant, or a bypass', async () => {
    await expect(invoices.increment({}, 'amount', 1)).rejects.toBeInstanceOf(
      MissingTenantContextError,
    );
    // Inside a bypass TypeORM's own rule applies: an empty where is refused, so name the rows.
    await withoutTenantScope('bonus on all open invoices', () =>
      invoices.increment({ status: 'open' }, 'amount', 1),
    );
    expect(await amounts()).toEqual({ A1: 1, A2: 0, G1: 1, G2: 0 });
  });
});
