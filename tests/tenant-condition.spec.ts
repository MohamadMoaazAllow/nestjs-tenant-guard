import { In } from 'typeorm';
import { TenantMismatchError } from '../src';
import { scopeWhere, TenantCondition } from '../src/repository/tenant-condition';

const condition: TenantCondition = {
  entityName: 'Invoice',
  operation: 'find',
  column: 'tenantId',
  tenantId: 'acme',
};

describe('scopeWhere', () => {
  it('turns a missing where into a tenant-only branch', () => {
    expect(scopeWhere(undefined, condition)).toEqual([{ tenantId: 'acme' }]);
  });

  it('adds the tenant to a single object', () => {
    expect(scopeWhere({ status: 'open' }, condition)).toEqual([
      { status: 'open', tenantId: 'acme' },
    ]);
  });

  it('adds the tenant to every OR branch', () => {
    expect(scopeWhere([{ status: 'open' }, { title: 'x' }], condition)).toEqual([
      { status: 'open', tenantId: 'acme' },
      { title: 'x', tenantId: 'acme' },
    ]);
  });

  it('turns an empty array into a tenant-only branch instead of "no restriction"', () => {
    expect(scopeWhere([], condition)).toEqual([{ tenantId: 'acme' }]);
  });

  it('accepts a branch that already names the current tenant', () => {
    expect(scopeWhere({ tenantId: 'acme' }, condition)).toEqual([{ tenantId: 'acme' }]);
  });

  it('treats an undefined tenant value as absent', () => {
    expect(scopeWhere({ tenantId: undefined }, condition)).toEqual([{ tenantId: 'acme' }]);
  });

  it('throws when a branch names another tenant', () => {
    expect(() => scopeWhere({ tenantId: 'globex' }, condition)).toThrow(TenantMismatchError);
  });

  it('throws when any single OR branch names another tenant', () => {
    expect(() => scopeWhere([{ status: 'open' }, { tenantId: 'globex' }], condition)).toThrow(
      TenantMismatchError,
    );
  });

  it('throws for operator values, which could widen the filter', () => {
    expect(() => scopeWhere({ tenantId: In(['acme', 'globex']) }, condition)).toThrow(
      TenantMismatchError,
    );
  });

  it('does not mutate its input', () => {
    const where = [{ status: 'open' }];
    scopeWhere(where, condition);
    expect(where).toEqual([{ status: 'open' }]);
  });
});
