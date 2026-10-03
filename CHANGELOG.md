# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-03

### Added

- `@TenantScoped({ column })` decorator to mark entities as tenant-scoped.
- Per-request tenant context based on `AsyncLocalStorage`: `runWithTenant`, `getCurrentTenantId`.
- `TenantRepository` and `createTenantRepository`: automatic tenant scoping for `find*`, `count*`,
  `exists*`, `update`, `delete`, `softDelete`, `restore` and `createQueryBuilder`, with the tenant
  applied to every branch of array (`OR`) where clauses.
- `TenantSubscriber`: stamps the current tenant on insert and rejects rows of another tenant.
- `withoutTenantScope(reason, fn)`: explicit, logged bypass that requires a reason.
- `MissingTenantContextError` and `TenantMismatchError`.
- `TenantGuardModule.forRoot`, `forRootAsync` and `forFeature`, `TenantContextMiddleware` and
  `@InjectTenantRepository`.
- `TenantResolver` interface and `HeaderTenantResolver` (default header `x-tenant-id`).
- Example NestJS app, including a JWT-based resolver.
