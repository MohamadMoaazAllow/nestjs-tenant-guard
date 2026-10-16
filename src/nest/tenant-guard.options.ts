import { FactoryProvider, ModuleMetadata } from '@nestjs/common';
import { TenantResolver } from '../resolvers/tenant-resolver.interface';

/**
 * Options for `TenantGuardModule`. Pass either a custom `resolver` or the `header` the
 * default resolver should read, never both: the union makes the ambiguous call a type error.
 */
export type TenantGuardOptions = TenantGuardCommonOptions &
  (
    | {
        /** Custom way of finding the tenant of a request, e.g. from a verified JWT. */
        readonly resolver: TenantResolver;
        readonly header?: never;
      }
    | {
        readonly resolver?: never;
        /** Header read by the default resolver. Defaults to `x-tenant-id`. */
        readonly header?: string;
      }
  );

/** Options that apply whichever resolver is used. */
export interface TenantGuardCommonOptions {
  /**
   * Verify every loaded row of a tenant-scoped entity against the current tenant, so joins,
   * `relations` and plain repositories fail loudly instead of leaking. Default `false`.
   * See `TenantSubscriberOptions.verifyLoadedRows`.
   */
  readonly verifyLoadedRows?: boolean;
}

/** Async options for `TenantGuardModule.forRootAsync`. */
export interface TenantGuardAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  /** Providers to inject into `useFactory`, e.g. a `JwtService` for a JWT resolver. */
  readonly inject?: FactoryProvider['inject'];
  // `never[]` instead of `any[]`: any factory signature is assignable to it, and the
  // arguments are supplied by Nest's DI, not by our code.
  readonly useFactory: (...args: never[]) => TenantGuardOptions | Promise<TenantGuardOptions>;
}
