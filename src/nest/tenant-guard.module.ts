import { DynamicModule, MiddlewareConsumer, Module, NestModule, Provider } from '@nestjs/common';
import { DataSource, ObjectLiteral } from 'typeorm';
import { HeaderTenantResolver } from '../resolvers/header-tenant.resolver';
import { createTenantRepository } from '../repository/create-tenant-repository';
import { EntityClass } from '../repository/entity-class';
import { registerTenantSubscriber, TenantSubscriber } from '../subscriber/tenant.subscriber';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { TenantGuardAsyncOptions, TenantGuardOptions } from './tenant-guard.options';
import { getTenantRepositoryToken, TENANT_GUARD_OPTIONS, TENANT_RESOLVER } from './tokens';

/** Holds the repositories registered by `TenantGuardModule.forFeature`. */
@Module({})
class TenantGuardFeatureModule {}

/**
 * Wires tenant isolation into a Nest app: a middleware that opens the tenant context per
 * request, and the insert subscriber on the app's TypeORM `DataSource`.
 *
 * Requires a `DataSource` provider, which `TypeOrmModule.forRoot()` supplies.
 */
@Module({})
export class TenantGuardModule implements NestModule {
  /** Registers the module with fixed options. Global, so import it once in the root module. */
  static forRoot(options: TenantGuardOptions = {}): DynamicModule {
    return TenantGuardModule.build([{ provide: TENANT_GUARD_OPTIONS, useValue: options }]);
  }

  /** Registers the module with options built by a factory, e.g. to inject a JWT service. */
  static forRootAsync(options: TenantGuardAsyncOptions): DynamicModule {
    return TenantGuardModule.build(
      [
        {
          provide: TENANT_GUARD_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ],
      options.imports,
    );
  }

  /**
   * Registers a `TenantRepository` for each entity, injectable with `@InjectTenantRepository`.
   * Import it in the module that uses them, like `TypeOrmModule.forFeature`.
   */
  static forFeature(entities: EntityClass<ObjectLiteral>[]): DynamicModule {
    const providers: Provider[] = entities.map((entity) => ({
      provide: getTenantRepositoryToken(entity),
      useFactory: (dataSource: DataSource) => createTenantRepository(dataSource, entity),
      inject: [DataSource],
    }));
    return {
      module: TenantGuardFeatureModule,
      providers,
      exports: entities.map(getTenantRepositoryToken),
    };
  }

  /** Applies the tenant middleware to every route. */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }

  private static build(
    optionProviders: Provider[],
    imports: DynamicModule['imports'] = [],
  ): DynamicModule {
    return {
      module: TenantGuardModule,
      global: true,
      imports,
      providers: [
        ...optionProviders,
        {
          provide: TENANT_RESOLVER,
          useFactory: (options: TenantGuardOptions) =>
            options.resolver ?? new HeaderTenantResolver(options.header),
          inject: [TENANT_GUARD_OPTIONS],
        },
        {
          provide: TenantSubscriber,
          useFactory: (dataSource: DataSource, options: TenantGuardOptions) =>
            registerTenantSubscriber(dataSource, { verifyLoadedRows: options.verifyLoadedRows }),
          inject: [DataSource, TENANT_GUARD_OPTIONS],
        },
        TenantContextMiddleware,
      ],
    };
  }
}
