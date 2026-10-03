import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { isValidTenantId, runWithTenant } from '../context/tenant-context';
import { TenantRequest, TenantResolver } from '../resolvers/tenant-resolver.interface';
import { TENANT_RESOLVER } from './tokens';

/**
 * Resolves the tenant of each request and runs the rest of the request inside that
 * tenant's async context.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware<TenantRequest, unknown> {
  constructor(@Inject(TENANT_RESOLVER) private readonly resolver: TenantResolver) {}

  /** Resolves the tenant, then continues the request inside its context. */
  async use(
    request: TenantRequest,
    _response: unknown,
    next: (error?: unknown) => void,
  ): Promise<void> {
    let tenantId: string | undefined;
    try {
      tenantId = await this.resolver.resolve(request);
    } catch (error) {
      // Forward instead of rejecting: nothing awaits this promise, so a rejection would be
      // an unhandled one and the request would hang.
      next(error);
      return;
    }

    if (!isValidTenantId(tenantId)) {
      // No tenant is not an error here: public routes and health checks have none. Queries
      // on scoped entities will refuse to run, which is where it matters.
      next();
      return;
    }
    // `next` must be called inside `run`, so the whole downstream chain inherits the context.
    runWithTenant(tenantId, () => next());
  }
}
