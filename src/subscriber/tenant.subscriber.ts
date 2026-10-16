import {
  DataSource,
  EntityMetadata,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  LoadEvent,
  ObjectLiteral,
  RecoverEvent,
  RemoveEvent,
  SoftRemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { currentScope, getCurrentTenantId, isTenantScopeBypassed } from '../context/tenant-context';
import { getTenantScope, TenantScopeConfig } from '../decorators/tenant-scoped.decorator';
import { TenantMismatchError } from '../errors/tenant-mismatch.error';

/** Options for {@link TenantSubscriber} and {@link registerTenantSubscriber}. */
export interface TenantSubscriberOptions {
  /**
   * Check every loaded row of a tenant-scoped entity against the current tenant and throw
   * `TenantMismatchError` on a row of another tenant. Catches leaks through paths the
   * repository cannot scope: `relations`, query builder joins, sub-queries and plain
   * repositories. Only active while a tenant is set; bypassed and tenant-less code is not
   * checked. Default `false`.
   */
  readonly verifyLoadedRows?: boolean;
}

/** A row-level event whose existing database row TypeORM loaded by primary key. */
type ExistingRowEvent =
  | UpdateEvent<ObjectLiteral>
  | RemoveEvent<ObjectLiteral>
  | SoftRemoveEvent<ObjectLiteral>
  | RecoverEvent<ObjectLiteral>;

// Without @EventSubscriber(), TypeORM ignores the class when it is listed in the DataSource's
// `subscribers` option.
/**
 * Guards every write of a tenant-scoped entity that goes through the DataSource it is
 * registered on, including plain repositories:
 *
 *  - insert: stamps the current tenant on new rows and rejects rows that name another one;
 *  - update, remove, soft-remove and recover by primary key (`save`, `remove`, ...): rejects
 *    the write when the existing row belongs to another tenant, or when it would move the
 *    row to another tenant;
 *  - optionally, every loaded row (see {@link TenantSubscriberOptions.verifyLoadedRows}).
 *
 * Query-builder updates and deletes emit events without the stored rows: for them this only
 * requires a tenant (or a bypass) and rejects setting the tenant column to another tenant;
 * filtering their rows is `TenantRepository`'s job. Raw SQL never reaches subscribers.
 */
@EventSubscriber()
export class TenantSubscriber implements EntitySubscriberInterface {
  private verifyLoadedRows: boolean;

  constructor(options: TenantSubscriberOptions = {}) {
    this.verifyLoadedRows = options.verifyLoadedRows ?? false;
  }

  /** Updates the options of an already registered subscriber. */
  configure(options: TenantSubscriberOptions): void {
    if (options.verifyLoadedRows !== undefined) {
      this.verifyLoadedRows = options.verifyLoadedRows;
    }
  }

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

  /**
   * Called before `save()` updates an existing row. Without this check, `save({ id, ... })`
   * with an id of another tenant would overwrite that tenant's row: TypeORM loads the row
   * by primary key only.
   */
  beforeUpdate(event: UpdateEvent<ObjectLiteral>): void {
    this.assertExistingRow(event, 'update');
  }

  /** Called before `remove()` deletes a loaded row. */
  beforeRemove(event: RemoveEvent<ObjectLiteral>): void {
    this.assertExistingRow(event, 'remove');
  }

  /** Called before `softRemove()` soft-deletes a loaded row. */
  beforeSoftRemove(event: SoftRemoveEvent<ObjectLiteral>): void {
    this.assertExistingRow(event, 'softRemove');
  }

  /** Called before `recover()` restores a soft-deleted row. */
  beforeRecover(event: RecoverEvent<ObjectLiteral>): void {
    this.assertExistingRow(event, 'recover');
  }

  /**
   * Called for every entity TypeORM builds from a query result, joined relations included.
   * Only checks anything when `verifyLoadedRows` is on.
   */
  afterLoad(entity: ObjectLiteral, event?: LoadEvent<ObjectLiteral>): void {
    if (!this.verifyLoadedRows || isTenantScopeBypassed()) {
      return;
    }
    const tenantId = getCurrentTenantId();
    if (tenantId === undefined) {
      // Tenant-less reads (public routes, scripts) are governed by the repository, which
      // already refuses them on scoped entities.
      return;
    }
    const metadata = event?.metadata;
    const scopeConfig = getTenantScope(metadata?.target ?? entity.constructor);
    if (!scopeConfig) {
      return;
    }
    const loaded: unknown = entity[scopeConfig.column];
    // A partial select without the tenant column cannot be checked.
    if (loaded !== undefined && loaded !== tenantId) {
      throw new TenantMismatchError(entityName(metadata, entity), 'load', tenantId, loaded);
    }
  }

  private assertExistingRow(event: ExistingRowEvent, operation: string): void {
    const scopeConfig = getTenantScope(event.metadata.target);
    if (!scopeConfig) {
      return;
    }
    const scope = currentScope(event.metadata.name, operation);
    if (scope.bypassed) {
      return;
    }
    // The row as stored: decides whose row this is.
    assertSameTenant(
      event.databaseEntity,
      scopeConfig,
      event.metadata.name,
      operation,
      scope.tenantId,
    );
    // The row as written: must not hand the row to another tenant (or to no tenant).
    if (operation === 'update') {
      assertSameTenant(event.entity, scopeConfig, event.metadata.name, operation, scope.tenantId);
    }
  }
}

function assertSameTenant(
  row: ObjectLiteral | undefined,
  scopeConfig: TenantScopeConfig,
  entity: string,
  operation: string,
  tenantId: string,
): void {
  if (!row || !(scopeConfig.column in row)) {
    return;
  }
  const value: unknown = row[scopeConfig.column];
  if (value !== undefined && value !== tenantId) {
    throw new TenantMismatchError(entity, operation, tenantId, value);
  }
}

function entityName(metadata: EntityMetadata | undefined, entity: ObjectLiteral): string {
  return metadata?.name ?? (entity.constructor as { name?: string }).name ?? 'unknown';
}

/**
 * Registers a {@link TenantSubscriber} on an initialized DataSource, once.
 * The check keeps this safe to call when the subscriber was also listed in the DataSource
 * options; in that case the given options are applied to the existing subscriber.
 */
export function registerTenantSubscriber(
  dataSource: DataSource,
  options: TenantSubscriberOptions = {},
): TenantSubscriber {
  const existing = dataSource.subscribers.find(
    (subscriber): subscriber is TenantSubscriber => subscriber instanceof TenantSubscriber,
  );
  if (existing) {
    existing.configure(options);
    return existing;
  }
  const subscriber = new TenantSubscriber(options);
  dataSource.subscribers.push(subscriber);
  return subscriber;
}
