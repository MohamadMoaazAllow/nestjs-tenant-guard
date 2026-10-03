import {
  DeepPartial,
  DeleteResult,
  EntityManager,
  FindManyOptions,
  FindOneOptions,
  InsertResult,
  ObjectLiteral,
  QueryRunner,
  Repository,
  SaveOptions,
  SelectQueryBuilder,
  UpdateResult,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { currentScope } from '../context/tenant-context';
import {
  assertTenantColumnUnchanged,
  scopeWhere,
  TenantCondition,
  WhereClause,
} from './tenant-condition';

/** Static facts about the entity a {@link TenantRepository} serves. */
export interface TenantRepositoryConfig {
  readonly entityName: string;
  /** Property name of the tenant column. */
  readonly column: string;
}

const TENANT_PARAMETER = 'tenantGuardTenantId';

/**
 * A repository that adds the current tenant to every read, update and delete.
 *
 * It is a wrapper, not a subclass of TypeORM's `Repository`, on purpose: a subclass would
 * silently inherit unscoped methods (`sum`, `increment`, `remove`, ...). Anything not
 * listed here is simply not available; use `createQueryBuilder()` for those cases.
 *
 * Only repositories created through this library are protected. A plain
 * `@InjectRepository(Entity)` or `dataSource.getRepository(Entity)` is not, and neither is
 * raw SQL (`manager.query`, `dataSource.query`).
 *
 * Build instances with `createTenantRepository` or `TenantGuardModule.forFeature`.
 */
export class TenantRepository<E extends ObjectLiteral> {
  constructor(
    private readonly repository: Repository<E>,
    private readonly config: TenantRepositoryConfig,
  ) {}

  /** Returns a repository bound to `manager`, e.g. the one handed to a transaction callback. */
  withManager(manager: EntityManager): TenantRepository<E> {
    // `dataSource.getRepository()` always uses the root manager, so queries made through the
    // original instance would silently run outside a transaction.
    return new TenantRepository(manager.getRepository(this.repository.target), this.config);
  }

  /** Scoped `find`. */
  async find(options?: FindManyOptions<E>): Promise<E[]> {
    return this.repository.find(this.scopeOptions('find', options));
  }

  /** Scoped `findBy`. */
  async findBy(where: WhereClause<E>): Promise<E[]> {
    return this.repository.findBy(this.scopeWhere('findBy', where));
  }

  /** Scoped `findAndCount`. */
  async findAndCount(options?: FindManyOptions<E>): Promise<[E[], number]> {
    return this.repository.findAndCount(this.scopeOptions('findAndCount', options));
  }

  /** Scoped `findAndCountBy`. */
  async findAndCountBy(where: WhereClause<E>): Promise<[E[], number]> {
    return this.repository.findAndCountBy(this.scopeWhere('findAndCountBy', where));
  }

  /** Scoped `findOne`. */
  async findOne(options: FindOneOptions<E>): Promise<E | null> {
    return this.repository.findOne(this.scopeOptions('findOne', options));
  }

  /** Scoped `findOneBy`. */
  async findOneBy(where: WhereClause<E>): Promise<E | null> {
    return this.repository.findOneBy(this.scopeWhere('findOneBy', where));
  }

  /** Scoped `findOneOrFail`. */
  async findOneOrFail(options: FindOneOptions<E>): Promise<E> {
    return this.repository.findOneOrFail(this.scopeOptions('findOneOrFail', options));
  }

  /** Scoped `findOneByOrFail`. */
  async findOneByOrFail(where: WhereClause<E>): Promise<E> {
    return this.repository.findOneByOrFail(this.scopeWhere('findOneByOrFail', where));
  }

  /** Scoped `count`. */
  async count(options?: FindManyOptions<E>): Promise<number> {
    return this.repository.count(this.scopeOptions('count', options));
  }

  /** Scoped `countBy`. */
  async countBy(where: WhereClause<E>): Promise<number> {
    return this.repository.countBy(this.scopeWhere('countBy', where));
  }

  /** Scoped `exists`. */
  async exists(options?: FindManyOptions<E>): Promise<boolean> {
    return this.repository.exists(this.scopeOptions('exists', options));
  }

  /** Scoped `existsBy`. */
  async existsBy(where: WhereClause<E>): Promise<boolean> {
    return this.repository.existsBy(this.scopeWhere('existsBy', where));
  }

  /**
   * Scoped `update`. Criteria must be a `where` object (or array of them); bare ids are not
   * accepted, write `{ id }`. Refuses to change the tenant column to another tenant.
   */
  async update(
    criteria: WhereClause<E>,
    partial: QueryDeepPartialEntity<E>,
  ): Promise<UpdateResult> {
    const condition = this.condition('update');
    if (condition) {
      assertTenantColumnUnchanged(partial, condition);
    }
    // These run through a query builder, mirroring EntityManager. Handing an array to
    // Repository.update would route it to the primary-key (`whereInIds`) path and drop
    // the tenant key from every branch.
    return this.repository.manager
      .createQueryBuilder()
      .update(this.repository.target)
      .set(partial)
      .where(this.scopeWhere('update', criteria))
      .execute();
  }

  /** Scoped `delete`. Criteria must be a `where` object (or array of them). */
  async delete(criteria: WhereClause<E>): Promise<DeleteResult> {
    return this.repository.manager
      .createQueryBuilder()
      .delete()
      .from(this.repository.target)
      .where(this.scopeWhere('delete', criteria))
      .execute();
  }

  /** Scoped `softDelete`. Criteria must be a `where` object (or array of them). */
  async softDelete(criteria: WhereClause<E>): Promise<UpdateResult> {
    return this.repository.manager
      .createQueryBuilder()
      .softDelete()
      .from(this.repository.target)
      .where(this.scopeWhere('softDelete', criteria))
      .execute();
  }

  /** Scoped `restore` (undoes `softDelete`). Criteria must be a `where` object (or array). */
  async restore(criteria: WhereClause<E>): Promise<UpdateResult> {
    return this.repository.manager
      .createQueryBuilder()
      .restore()
      .from(this.repository.target)
      .where(this.scopeWhere('restore', criteria))
      .execute();
  }

  /**
   * Scoped query builder. The tenant condition is attached outside of whatever the caller
   * adds, so `.where()`, `.orWhere()` and friends cannot remove or bypass it.
   *
   * Limits: joined entities and sub-queries are built from other aliases and stay unscoped,
   * so filter them yourself or join through a foreign key that already implies the tenant.
   * Switching the builder with `.update()`, `.delete()`, `.softDelete()` or `.restore()` is
   * not supported and fails with a SQL error; call the repository methods of the same name.
   */
  createQueryBuilder(alias?: string, queryRunner?: QueryRunner): SelectQueryBuilder<E> {
    const builder = this.repository.createQueryBuilder(alias, queryRunner);
    const condition = this.condition('createQueryBuilder');
    if (condition) {
      // Why not `.andWhere()`: a later `.where()` resets the where list and wipes it, and
      // `a OR b AND tenant` parses as `a OR (b AND tenant)`. TypeORM wraps this slot as
      // `( user conditions ) AND ( tenant )`, which is what we need. One caveat: TypeORM
      // itself overwrites the slot on the second query of a paginated (take/skip + join)
      // fetch, but that query only loads ids already selected by the scoped first one.
      builder.expressionMap.extraAppendedAndWhereCondition = `${builder.alias}.${condition.column} = :${TENANT_PARAMETER}`;
      builder.setParameter(TENANT_PARAMETER, condition.tenantId);
    }
    return builder;
  }

  /** Same as `Repository.create`. Provided so callers never need an unscoped repository. */
  create(entityLike?: DeepPartial<E>): E {
    return entityLike === undefined ? this.repository.create() : this.repository.create(entityLike);
  }

  /**
   * Same as `Repository.save`. The tenant column is stamped and validated on insert by
   * `TenantSubscriber`. Saving an entity that already has a primary key updates the row by
   * that key and is not tenant-checked, so load entities through this repository first.
   */
  save<T extends DeepPartial<E>>(entities: T[], options?: SaveOptions): Promise<(T & E)[]>;
  save<T extends DeepPartial<E>>(entity: T, options?: SaveOptions): Promise<T & E>;
  async save<T extends DeepPartial<E>>(
    entityOrEntities: T | T[],
    options?: SaveOptions,
  ): Promise<(T & E)[] | (T & E)> {
    // Both branches look identical, but TypeORM's overloads only accept a narrowed argument.
    return Array.isArray(entityOrEntities)
      ? this.repository.save(entityOrEntities, options)
      : this.repository.save(entityOrEntities, options);
  }

  /** Same as `Repository.insert`. The tenant column is stamped and validated by `TenantSubscriber`. */
  async insert(
    entity: QueryDeepPartialEntity<E> | QueryDeepPartialEntity<E>[],
  ): Promise<InsertResult> {
    return this.repository.insert(entity);
  }

  /** Returns the tenant condition for the current context, or `undefined` while bypassed. */
  private condition(operation: string): TenantCondition | undefined {
    const scope = currentScope(this.config.entityName, operation);
    return scope.bypassed ? undefined : { ...this.config, operation, tenantId: scope.tenantId };
  }

  private scopeWhere(operation: string, where: WhereClause<E> = {}): WhereClause<E> {
    const condition = this.condition(operation);
    return condition ? scopeWhere(where, condition) : where;
  }

  private scopeOptions<O extends { where?: WhereClause<E> }>(
    operation: string,
    options: O | undefined,
  ): O {
    return { ...options, where: this.scopeWhere(operation, options?.where) } as O;
  }
}
