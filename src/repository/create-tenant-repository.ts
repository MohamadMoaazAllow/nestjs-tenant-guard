import { DataSource, ObjectLiteral } from 'typeorm';
import { getTenantScope } from '../decorators/tenant-scoped.decorator';
import { EntityClass } from './entity-class';
import { TenantRepository } from './tenant-repository';

/**
 * Creates a tenant-scoped repository for a `@TenantScoped()` entity.
 *
 * Fails at creation time, not at first query, when the entity is not decorated or the
 * configured column does not exist: a typo here would otherwise only show up as a
 * confusing SQL error (or worse, as a repository that scopes nothing).
 */
export function createTenantRepository<E extends ObjectLiteral>(
  dataSource: DataSource,
  entity: EntityClass<E>,
): TenantRepository<E> {
  const scope = getTenantScope(entity);
  if (!scope) {
    throw new Error(
      `${entity.name} is not tenant-scoped. Decorate it with @TenantScoped(), or use a ` +
        `regular repository if the entity is meant to be global.`,
    );
  }
  const metadata = dataSource.getMetadata(entity);
  if (!metadata.findColumnWithPropertyName(scope.column)) {
    throw new Error(
      `${entity.name} has no column mapped to property "${scope.column}", which ` +
        `@TenantScoped() uses as the tenant column.`,
    );
  }
  return new TenantRepository(dataSource.getRepository(entity), {
    entityName: metadata.name,
    column: scope.column,
  });
}
