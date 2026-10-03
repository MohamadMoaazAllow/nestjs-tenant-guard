import { Injectable } from '@nestjs/common';
import { TenantRequest, TenantResolver } from 'nestjs-tenant-guard';

/**
 * The only thing needed from a JWT library. `JwtService` from `@nestjs/jwt` satisfies it,
 * so this example does not force that dependency on the library.
 */
export interface JwtVerifier {
  verifyAsync(token: string): Promise<{ tenantId?: unknown }>;
}

/**
 * Resolves the tenant from the `tenantId` claim of a verified bearer token.
 *
 * Wire it up with:
 *
 * ```ts
 * TenantGuardModule.forRootAsync({
 *   imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
 *   inject: [JwtService],
 *   useFactory: (jwt: JwtService) => ({ resolver: new JwtTenantResolver(jwt) }),
 * });
 * ```
 */
@Injectable()
export class JwtTenantResolver implements TenantResolver {
  constructor(private readonly jwt: JwtVerifier) {}

  async resolve(request: TenantRequest): Promise<string | undefined> {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      return undefined;
    }
    try {
      // Verify here: this runs in middleware, before any auth guard has populated
      // `request.user`, and a decoded-but-unverified token would let anyone pick a tenant.
      const payload = await this.jwt.verifyAsync(authorization.slice('Bearer '.length));
      return typeof payload.tenantId === 'string' ? payload.tenantId : undefined;
    } catch {
      // An invalid token means "no tenant", not a crash. Scoped queries will then refuse to
      // run, and your auth guard is the place that answers 401.
      return undefined;
    }
  }
}
