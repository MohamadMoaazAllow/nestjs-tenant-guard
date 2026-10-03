import { Logger } from '@nestjs/common';
import {
  getCurrentTenantId,
  isTenantScopeBypassed,
  runWithTenant,
  withoutTenantScope,
} from '../src';

describe('tenant context', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('has no tenant outside of runWithTenant', () => {
    expect(getCurrentTenantId()).toBeUndefined();
    expect(isTenantScopeBypassed()).toBe(false);
  });

  it('exposes the tenant to the callback and across awaits', async () => {
    await runWithTenant('acme', async () => {
      expect(getCurrentTenantId()).toBe('acme');
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getCurrentTenantId()).toBe('acme');
    });
    expect(getCurrentTenantId()).toBeUndefined();
  });

  it('lets an inner tenant shadow the outer one', () => {
    runWithTenant('acme', () => {
      runWithTenant('globex', () => expect(getCurrentTenantId()).toBe('globex'));
      expect(getCurrentTenantId()).toBe('acme');
    });
  });

  it.each(['', '   '])('rejects the blank tenant id %p', (tenantId) => {
    expect(() => runWithTenant(tenantId, () => undefined)).toThrow(TypeError);
  });

  describe('withoutTenantScope', () => {
    it('logs the reason and flags the context', () => {
      withoutTenantScope('nightly billing job across all tenants', () => {
        expect(isTenantScopeBypassed()).toBe(true);
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'Tenant scope bypassed: nightly billing job across all tenants',
      );
      expect(isTenantScopeBypassed()).toBe(false);
    });

    it.each(['', '   '])('refuses the blank reason %p and logs nothing', (reason) => {
      expect(() => withoutTenantScope(reason, () => undefined)).toThrow(TypeError);
      expect(warn).not.toHaveBeenCalled();
    });

    it('returns the callback result, including promises', async () => {
      await expect(withoutTenantScope('test', async () => 42)).resolves.toBe(42);
    });

    it('keeps the surrounding tenant readable', () => {
      runWithTenant('acme', () => {
        withoutTenantScope('test', () => expect(getCurrentTenantId()).toBe('acme'));
      });
    });

    it('is switched off again by an explicit runWithTenant', () => {
      withoutTenantScope('list all tenants, then work per tenant', () => {
        runWithTenant('acme', () => expect(isTenantScopeBypassed()).toBe(false));
        expect(isTenantScopeBypassed()).toBe(true);
      });
    });
  });
});
