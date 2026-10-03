import { ObjectLiteral } from 'typeorm';
import { EntityClass } from '../repository/entity-class';

/** Injection token for the resolved {@link TenantGuardOptions}. */
export const TENANT_GUARD_OPTIONS = Symbol('TENANT_GUARD_OPTIONS');

/** Injection token for the active `TenantResolver`. */
export const TENANT_RESOLVER = Symbol('TENANT_RESOLVER');

/** Injection token of the `TenantRepository` for `entity`, as registered by `forFeature`. */
export function getTenantRepositoryToken(entity: EntityClass<ObjectLiteral>): string {
  return `TenantRepository<${entity.name}>`;
}
