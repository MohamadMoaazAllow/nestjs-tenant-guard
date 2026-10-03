/**
 * The slice of an incoming HTTP request that resolvers may read. Structural on purpose:
 * Express and Fastify request objects both satisfy it, so the library depends on neither.
 */
export interface TenantRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/**
 * Decides which tenant an incoming request belongs to.
 *
 * Return `undefined` when the request carries no tenant (health checks, public routes).
 * The request still goes through, and any query on a tenant-scoped entity then fails
 * with `MissingTenantContextError`.
 *
 * The resolver runs in middleware, i.e. BEFORE Nest guards. `request.user` set by an
 * auth guard is therefore not available here; verify the credential yourself.
 */
export interface TenantResolver {
  resolve(request: TenantRequest): string | undefined | Promise<string | undefined>;
}
