import 'reflect-metadata';

/** Column used when `@TenantScoped()` is called without options. */
export const DEFAULT_TENANT_COLUMN = 'tenantId';

const TENANT_SCOPE_METADATA = Symbol('nestjs-tenant-guard:tenant-scope');

/** Options for {@link TenantScoped}. */
export interface TenantScopedOptions {
  /**
   * Property name (not database column name) holding the tenant id. It must be a
   * plain top-level property of the entity. Defaults to `tenantId`.
   */
  readonly column?: string;
}

/** Resolved scoping configuration of an entity. */
export interface TenantScopeConfig {
  readonly column: string;
}

/**
 * Marks an entity as tenant-scoped. Put it next to `@Entity()`:
 *
 * ```ts
 * @TenantScoped({ column: 'tenantId' })
 * @Entity()
 * export class Invoice { ... }
 * ```
 */
export function TenantScoped(options: TenantScopedOptions = {}): ClassDecorator {
  const column = options.column ?? DEFAULT_TENANT_COLUMN;
  if (column.trim() === '') {
    throw new TypeError('@TenantScoped: column must be a non-empty property name.');
  }
  return (target) => {
    Reflect.defineMetadata(TENANT_SCOPE_METADATA, { column }, target);
  };
}

/**
 * Returns the scoping configuration of an entity class, or `undefined` if it is not
 * tenant-scoped. Subclasses inherit the configuration of their parent on purpose, so
 * extending a scoped entity can never silently drop the protection.
 */
export function getTenantScope(target: unknown): TenantScopeConfig | undefined {
  if (typeof target !== 'function') {
    // EntitySchema targets are plain strings; the decorator cannot apply to them.
    return undefined;
  }
  return Reflect.getMetadata(TENANT_SCOPE_METADATA, target) as TenantScopeConfig | undefined;
}
