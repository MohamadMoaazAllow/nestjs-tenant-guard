export { MissingTenantContextError } from './errors/missing-tenant-context.error';
export { TenantMismatchError } from './errors/tenant-mismatch.error';

export {
  getCurrentTenantId,
  isTenantScopeBypassed,
  runWithTenant,
  withoutTenantScope,
} from './context/tenant-context';

export {
  DEFAULT_TENANT_COLUMN,
  TenantScoped,
  getTenantScope,
  TenantScopedOptions,
  TenantScopeConfig,
} from './decorators/tenant-scoped.decorator';

export { TenantRequest, TenantResolver } from './resolvers/tenant-resolver.interface';
export { DEFAULT_TENANT_HEADER, HeaderTenantResolver } from './resolvers/header-tenant.resolver';

export { EntityClass } from './repository/entity-class';
export { TenantRepository } from './repository/tenant-repository';
export { createTenantRepository } from './repository/create-tenant-repository';

export { TenantSubscriber, registerTenantSubscriber } from './subscriber/tenant.subscriber';

export { TenantGuardModule } from './nest/tenant-guard.module';
export { TenantGuardAsyncOptions, TenantGuardOptions } from './nest/tenant-guard.options';
export { TenantContextMiddleware } from './nest/tenant-context.middleware';
export { InjectTenantRepository } from './nest/inject-tenant-repository';
export { getTenantRepositoryToken } from './nest/tokens';
