import { FindOptionsWhere, ObjectLiteral } from 'typeorm';
import { TenantMismatchError } from '../errors/tenant-mismatch.error';

/** A TypeORM `where`: one object, or an array whose items are OR-ed together. */
export type WhereClause<E> = FindOptionsWhere<E> | FindOptionsWhere<E>[];

/** Everything needed to build and explain the tenant condition of one operation. */
export interface TenantCondition {
  readonly entityName: string;
  readonly operation: string;
  readonly column: string;
  readonly tenantId: string;
}

/**
 * Adds the tenant condition to every OR branch of `where`.
 *
 * Always returns an array. Two traps are handled here:
 *  - `[{ a: 1 }, { b: 2 }]` means `a OR b`. Adding the tenant to only one branch, or
 *    AND-ing it after the fact, would let the other branch read every tenant.
 *  - `[]` means "no restriction" to TypeORM. It must still become a tenant-only branch.
 *
 * A branch that already names this column with a different value throws instead of being
 * overwritten: silently swapping it would return the wrong rows without any signal.
 */
export function scopeWhere<E extends ObjectLiteral>(
  where: WhereClause<E> | undefined,
  condition: TenantCondition,
): FindOptionsWhere<E>[] {
  const branches = Array.isArray(where) ? where : [where ?? {}];
  const nonEmpty = branches.length === 0 ? [{}] : branches;
  return nonEmpty.map((branch) => scopeBranch(branch, condition));
}

/**
 * Throws if `values` tries to move a row to another tenant. Without this, an `update`
 * could set the tenant column and hand a row to a different tenant.
 */
export function assertTenantColumnUnchanged(
  values: ObjectLiteral,
  condition: TenantCondition,
): void {
  const supplied: unknown = values[condition.column];
  if (supplied !== undefined && supplied !== condition.tenantId) {
    throw new TenantMismatchError(
      condition.entityName,
      condition.operation,
      condition.tenantId,
      supplied,
    );
  }
}

function scopeBranch<E extends ObjectLiteral>(
  branch: FindOptionsWhere<E>,
  condition: TenantCondition,
): FindOptionsWhere<E> {
  // `undefined` values are skipped by TypeORM, so they do not count as naming a tenant.
  assertTenantColumnUnchanged(branch, condition);
  // The cast is the one place the dynamic column name meets the entity's static type.
  return { ...branch, [condition.column]: condition.tenantId } as FindOptionsWhere<E>;
}
