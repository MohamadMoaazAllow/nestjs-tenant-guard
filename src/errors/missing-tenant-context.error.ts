/**
 * Thrown when a tenant-scoped entity is touched while no tenant is known in the
 * current async context.
 *
 * This is deliberately an error and never a fallback to "all rows": a request that
 * lost its tenant must fail, not quietly see every tenant's data.
 */
export class MissingTenantContextError extends Error {
  constructor(
    /** Name of the tenant-scoped entity that was accessed. */
    readonly entityName: string,
    /** The repository or subscriber operation that was refused, e.g. "find". */
    readonly operation: string,
  ) {
    super(
      `No tenant in the current context: refusing to run "${operation}" on tenant-scoped ` +
        `entity "${entityName}". Make sure the request passes through TenantGuardModule's ` +
        `middleware (or runWithTenant), or wrap deliberate cross-tenant work in ` +
        `withoutTenantScope(reason, fn).`,
    );
    this.name = 'MissingTenantContextError';
  }
}
