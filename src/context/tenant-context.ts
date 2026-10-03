import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from '@nestjs/common';
import { MissingTenantContextError } from '../errors/missing-tenant-context.error';

interface TenantStore {
  readonly tenantId: string | undefined;
  readonly scopeBypassed: boolean;
}

/** What a query on a tenant-scoped entity must do right now. */
export type TenantScope =
  { readonly bypassed: true } | { readonly bypassed: false; readonly tenantId: string };

// AsyncLocalStorage instead of request-scoped providers: request scope makes Nest
// re-instantiate the whole dependency chain per request, which is expensive.
const storage = new AsyncLocalStorage<TenantStore>();
const logger = new Logger('TenantGuard');

/** True for a non-blank string. Blank ids are rejected: `''` is falsy and easy to mishandle. */
export function isValidTenantId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Runs `callback` with `tenantId` as the current tenant. The tenant follows every
 * `await` started inside the callback and is invisible to concurrent callers.
 *
 * Entering a tenant explicitly always turns scoping back on, even inside
 * `withoutTenantScope`. That makes "list all tenants, then work per tenant" jobs safe.
 */
export function runWithTenant<T>(tenantId: string, callback: () => T): T {
  if (!isValidTenantId(tenantId)) {
    throw new TypeError('runWithTenant: tenantId must be a non-empty string.');
  }
  return storage.run({ tenantId, scopeBypassed: false }, callback);
}

/** Returns the tenant id of the current async context, or `undefined` if there is none. */
export function getCurrentTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}

/** True while running inside `withoutTenantScope`. */
export function isTenantScopeBypassed(): boolean {
  return storage.getStore()?.scopeBypassed === true;
}

/**
 * The only way to run queries without tenant scoping. The call is greppable, needs a
 * human-readable reason, and logs that reason as a warning on every use.
 *
 * Inside the callback nothing is scoped, stamped or validated on tenant-scoped entities.
 * Raw SQL is unaffected either way, it is never scoped.
 */
export function withoutTenantScope<T>(reason: string, callback: () => T): T {
  if (typeof reason !== 'string' || reason.trim() === '') {
    // A bypass without a reason defeats the point of making it explicit and reviewable.
    throw new TypeError('withoutTenantScope: a non-empty reason is required.');
  }
  logger.warn(`Tenant scope bypassed: ${reason}`);
  // The tenant (if any) is kept so code inside can still read getCurrentTenantId().
  return storage.run({ tenantId: getCurrentTenantId(), scopeBypassed: true }, callback);
}

/**
 * Decides how a tenant-scoped entity may be accessed right now. Throws
 * `MissingTenantContextError` when there is neither a tenant nor an explicit bypass.
 * Shared by the repository and the subscriber so both enforce the same rule.
 */
export function currentScope(entityName: string, operation: string): TenantScope {
  const store = storage.getStore();
  if (store?.scopeBypassed) {
    return { bypassed: true };
  }
  if (store?.tenantId === undefined) {
    throw new MissingTenantContextError(entityName, operation);
  }
  return { bypassed: false, tenantId: store.tenantId };
}
