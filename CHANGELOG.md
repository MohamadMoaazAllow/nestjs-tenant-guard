# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-16

### Security

- `save()` of an entity with a primary key could overwrite a row of another tenant, because
  TypeORM loads that row by id only (e.g. `PATCH /invoices/:id` with another tenant's id).
  `TenantSubscriber` now compares the stored row with the current tenant before `save` updates
  and before `remove`, `softRemove` and `recover`, on every path of the DataSource, and throws
  `TenantMismatchError`. `save` also refuses to move a row to another tenant or clear its tenant.

### Added

- `TenantRepository.remove`, `softRemove`, `recover`, `increment` and `decrement`.
- `verifyLoadedRows` option (`TenantGuardModule.forRoot`/`forRootAsync`,
  `registerTenantSubscriber(dataSource, options)`, `new TenantSubscriber(options)`): checks every
  loaded row of a tenant-scoped entity, joined relations included, and throws
  `TenantMismatchError` on a row of another tenant. Off by default.
- `TenantSubscriberOptions` and `TenantGuardCommonOptions` types.

### Changed

- Every write on a tenant-scoped entity now needs a tenant or `withoutTenantScope`, as inserts
  already did. Query-builder `update`/`delete`/`softDelete`/`restore` through a plain repository
  outside both now throw `MissingTenantContextError` instead of touching every tenant, and
  inside a tenant context they may not set the tenant column to another tenant.
- `TenantRepository.save` checks for a tenant before running any SQL.

### Fixed

- A test asserted a SQLite error with `toThrow()`, which failed depending on test file order
  because better-sqlite3's error class can come from another Jest realm.

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

[0.2.0]: https://github.com/MohamadMoaazAllow/nestjs-tenant-guard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/MohamadMoaazAllow/nestjs-tenant-guard/releases/tag/v0.1.0
