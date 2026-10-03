import { JwtTenantResolver } from '../example/src/jwt-tenant.resolver';

describe('JwtTenantResolver (example)', () => {
  const verifier = {
    async verifyAsync(token: string) {
      if (token === 'good') return { tenantId: 'acme' };
      if (token === 'no-claim') return {};
      throw new Error('invalid signature');
    },
  };
  const resolver = new JwtTenantResolver(verifier);
  const withAuth = (authorization?: string) => ({ headers: { authorization } });

  it('returns the tenant claim of a verified token', async () => {
    await expect(resolver.resolve(withAuth('Bearer good'))).resolves.toBe('acme');
  });

  it.each([
    ['no header', undefined],
    ['a non-bearer header', 'Basic abc'],
    ['an invalid token', 'Bearer forged'],
    ['a token without the claim', 'Bearer no-claim'],
  ])('resolves no tenant for %s', async (_label, header) => {
    await expect(resolver.resolve(withAuth(header))).resolves.toBeUndefined();
  });
});
