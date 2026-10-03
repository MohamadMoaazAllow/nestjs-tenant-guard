import {
  DataSource,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  ObjectLiteral,
} from 'typeorm';
import { currentScope } from '../context/tenant-context';
import { getTenantScope } from '../decorators/tenant-scoped.decorator';
import { TenantMismatchError } from '../errors/tenant-mismatch.error';

// Without @EventSubscriber(), TypeORM ignores the class when it is listed in the DataSource's
// `subscribers` option.
/**
 * Stamps the current tenant onto new rows of tenant-scoped entities and rejects rows that
 * name another tenant.
 *
 * Unlike `TenantRepository`, this protects every insert path that goes through the
 * DataSource it is registered on (`save`, `insert`, query builder inserts), including
 * plain repositories. Raw SQL inserts never reach subscribers.
 */
@EventSubscriber()
export class TenantSubscriber implements EntitySubscriberInterface {
  /** Called by TypeORM before each insert; throwing here aborts the insert. */
  beforeInsert(event: InsertEvent<ObjectLiteral>): void {
    const scopeConfig = getTenantScope(event.metadata.target);
    if (!scopeConfig) {
      return;
    }

    // No tenant and no bypass throws here: an insert that cannot be attributed to a tenant
    // must not create an orphan row.
    const scope = currentScope(event.metadata.name, 'insert');
    if (scope.bypassed) {
      return;
    }

    const supplied: unknown = event.entity[scopeConfig.column];
    if (supplied === undefined || supplied === null) {
      event.entity[scopeConfig.column] = scope.tenantId;
      return;
    }
    // Strict comparison on purpose: a number-vs-string mix-up is exactly the sort of bug
    // that should surface here instead of being coerced away.
    if (supplied !== scope.tenantId) {
      throw new TenantMismatchError(event.metadata.name, 'insert', scope.tenantId, supplied);
    }
  }
}

/**
 * Registers a {@link TenantSubscriber} on an initialized DataSource, once.
 * The check keeps this safe to call when the subscriber was also listed in the DataSource
 * options.
 */
export function registerTenantSubscriber(dataSource: DataSource): TenantSubscriber {
  const existing = dataSource.subscribers.find(
    (subscriber): subscriber is TenantSubscriber => subscriber instanceof TenantSubscriber,
  );
  if (existing) {
    return existing;
  }
  const subscriber = new TenantSubscriber();
  dataSource.subscribers.push(subscriber);
  return subscriber;
}
