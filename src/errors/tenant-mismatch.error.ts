/**
 * Thrown when code explicitly names a tenant other than the one in the current context,
 * for example by inserting a row, filtering, or updating a row's tenant column to a
 * different tenant id.
 *
 * Crossing tenants on purpose is possible, but only through `withoutTenantScope`.
 */
export class TenantMismatchError extends Error {
  constructor(
    /** Name of the tenant-scoped entity involved. */
    readonly entityName: string,
    /** The operation that was refused, e.g. "insert" or "update". */
    readonly operation: string,
    /** The tenant id of the current context. */
    readonly expectedTenantId: string,
    /** The tenant value the caller supplied. Typed `unknown`: it is caller input. */
    readonly actualTenantId: unknown,
  ) {
    super(
      `Tenant mismatch on "${operation}" for entity "${entityName}": the current tenant is ` +
        `"${expectedTenantId}" but the operation names ${JSON.stringify(actualTenantId)}. ` +
        `Use withoutTenantScope(reason, fn) if crossing tenants is intended.`,
    );
    this.name = 'TenantMismatchError';
  }
}
