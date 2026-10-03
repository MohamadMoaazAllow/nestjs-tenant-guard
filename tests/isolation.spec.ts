import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  getCurrentTenantId,
  isTenantScopeBypassed,
  runWithTenant,
  TenantRepository,
  withoutTenantScope,
} from '../src';
import { Invoice } from './helpers/entities';
import { createSeededInvoices, titles } from './helpers/test-database';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('concurrent requests', () => {
  let dataSource: DataSource;
  let invoices: TenantRepository<Invoice>;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    ({ dataSource, invoices } = await createSeededInvoices());
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await dataSource.destroy();
  });

  it('never see each other, even when their awaits interleave', async () => {
    const trace: string[] = [];

    // Each "request" pauses between queries with different delays, so the two always
    // overlap and take turns on the event loop.
    const request = (tenant: string, delays: number[]) =>
      runWithTenant(tenant, async () => {
        const seen: string[][] = [];
        for (const delay of delays) {
          await sleep(delay);
          trace.push(`${tenant}:${getCurrentTenantId()}`);
          seen.push(titles(await invoices.find()));
        }
        return seen;
      });

    const [acme, globex] = await Promise.all([
      request('acme', [6, 1, 6, 1]),
      request('globex', [1, 6, 1, 6]),
    ]);

    // Proof that the test really interleaved: neither tenant finished before the other started.
    const owners = trace.map((entry) => entry.split(':')[0]);
    expect(owners.indexOf('globex')).toBeLessThan(owners.lastIndexOf('acme'));
    expect(owners.indexOf('acme')).toBeLessThan(owners.lastIndexOf('globex'));

    // Every step saw its own tenant id in the context, and only its own rows.
    expect(trace.every((entry) => entry.split(':')[0] === entry.split(':')[1])).toBe(true);
    expect(acme).toEqual(Array(4).fill(['A1', 'A2']));
    expect(globex).toEqual(Array(4).fill(['G1', 'G2']));
  });

  it('do not leak a bypass into a concurrent request', async () => {
    const bypassing = withoutTenantScope('cross-tenant report', async () => {
      await sleep(5);
      return invoices.count();
    });
    const scoped = runWithTenant('acme', async () => {
      await sleep(1);
      const during = isTenantScopeBypassed();
      return { during, count: await invoices.count() };
    });

    expect(await bypassing).toBe(4);
    expect(await scoped).toEqual({ during: false, count: 2 });
  });

  it('keep writes apart as well', async () => {
    await Promise.all([
      runWithTenant('acme', async () => {
        await sleep(3);
        await invoices.save({ title: 'A3' });
      }),
      runWithTenant('globex', async () => {
        await invoices.save({ title: 'G3' });
        await sleep(3);
        await invoices.save({ title: 'G4' });
      }),
    ]);

    expect(titles(await runWithTenant('acme', () => invoices.find()))).toEqual(['A1', 'A2', 'A3']);
    expect(titles(await runWithTenant('globex', () => invoices.find()))).toEqual([
      'G1',
      'G2',
      'G3',
      'G4',
    ]);
  });
});
