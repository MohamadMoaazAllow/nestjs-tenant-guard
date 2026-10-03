import { DEFAULT_TENANT_HEADER, HeaderTenantResolver } from '../src';

describe('HeaderTenantResolver', () => {
  it('reads x-tenant-id by default', () => {
    expect(DEFAULT_TENANT_HEADER).toBe('x-tenant-id');
    expect(new HeaderTenantResolver().resolve({ headers: { 'x-tenant-id': 'acme' } })).toBe('acme');
  });

  it('reads a configured header, whatever case it was configured in', () => {
    const resolver = new HeaderTenantResolver('X-Org-Id');
    expect(resolver.resolve({ headers: { 'x-org-id': 'acme' } })).toBe('acme');
  });

  it('trims the value', () => {
    expect(new HeaderTenantResolver().resolve({ headers: { 'x-tenant-id': '  acme ' } })).toBe(
      'acme',
    );
  });

  it.each([
    ['absent', {}],
    ['blank', { 'x-tenant-id': '   ' }],
    ['repeated', { 'x-tenant-id': ['acme', 'globex'] }],
  ])('returns undefined when the header is %s', (_label, headers) => {
    expect(new HeaderTenantResolver().resolve({ headers })).toBeUndefined();
  });

  it('rejects an empty header name', () => {
    expect(() => new HeaderTenantResolver(' ')).toThrow(TypeError);
  });
});
