# nestjs-tenant-guard

Central, fail-loud tenant isolation for NestJS + TypeORM apps that share one database.

## The problem

In a multi-tenant app on a shared database, every query has to be filtered by the current tenant. Developers forget that condition. Nothing errors, tests with one tenant still pass, and one customer quietly sees another customer's data.

This library removes the need to remember. Tenant-scoped entities are filtered, stamped and validated in one central place, a missing tenant is an error instead of "all rows", and the only way around it is an explicit, logged, greppable call that needs a reason.

## Install

```bash
npm install nestjs-tenant-guard
```

Peer dependencies: `@nestjs/common`, `@nestjs/core`, `typeorm`, `reflect-metadata`. Tested with NestJS 11 and TypeORM 0.3 on Node 20+.

## Quick start

**1. Mark the entity.** `@TenantScoped()` goes next to `@Entity()`. The tenant column must exist on the entity.

```ts
@TenantScoped({ column: 'tenantId' }) // 'tenantId' is the default
@Entity()
export class Invoice {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ type: 'varchar' }) tenantId!: string;
  @Column({ type: 'varchar' }) title!: string;
}
```

**2. Register the module.** It needs a `DataSource` provider, which `TypeOrmModule.forRoot()` supplies.

```ts
@Module({
  imports: [
    TypeOrmModule.forRoot({/* ... */}),
    TenantGuardModule.forRoot({ header: 'x-tenant-id' }), // once, in the root module
    TenantGuardModule.forFeature([Invoice]), // where the repositories are used
  ],
})
export class AppModule {}
```

**3. Inject the tenant-aware repository.**

```ts
@Injectable()
export class InvoicesService {
  constructor(
    @InjectTenantRepository(Invoice) private readonly invoices: TenantRepository<Invoice>,
  ) {}

  list() {
    return this.invoices.find({ where: { title: Like('A%') } }); // tenant added for you
  }

  create(title: string) {
    return this.invoices.save({ title }); // tenantId stamped for you
  }
}
```

A runnable version lives in [`example/`](example) (`npm run example`).

## Configuration

### Resolving the tenant

`TenantGuardModule.forRoot` takes either a header name or a custom resolver, never both:

```ts
TenantGuardModule.forRoot({ header: 'x-org-id' }); // default: 'x-tenant-id'
TenantGuardModule.forRoot({ resolver: new MyResolver() });
```

`forRootAsync` accepts `imports`, `inject` and `useFactory` for resolvers that need other providers:

```ts
TenantGuardModule.forRootAsync({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
  inject: [JwtService],
  useFactory: (jwt: JwtService) => ({ resolver: new JwtTenantResolver(jwt) }),
});
```

A resolver implements `TenantResolver`: return the tenant id, or `undefined` if the request has none. A request without a tenant is still served (health checks, public routes, global entities), but any query on a tenant-scoped entity then throws.

**The default header resolver trusts the client.** Use it only when a gateway or reverse proxy sets the header and strips any client-supplied value. Otherwise derive the tenant from a verified credential. [`example/src/jwt-tenant.resolver.ts`](example/src/jwt-tenant.resolver.ts) reads it from a verified JWT. It verifies the token itself because the resolver runs in middleware, before guards, so `request.user` is not populated yet.

### Without the Nest module

```ts
const invoices = createTenantRepository(dataSource, Invoice);
registerTenantSubscriber(dataSource); // or subscribers: [TenantSubscriber] in the DataSource options

await runWithTenant('acme', () => invoices.find());
```

Use `runWithTenant` for everything the HTTP middleware does not cover: queue consumers, cron jobs, WebSocket handlers, microservice handlers, scripts.

### Transactions

`dataSource.getRepository()` always uses the root manager, so bind the repository to the transaction's manager:

```ts
await dataSource.transaction(async (manager) => {
  const invoices = this.invoices.withManager(manager);
  await invoices.save({ title: 'inside the transaction' });
});
```

## What is scoped

`TenantRepository` applies the current tenant to `find`, `findBy`, `findAndCount`, `findAndCountBy`, `findOne`, `findOneBy`, `findOneOrFail`, `findOneByOrFail`, `count`, `countBy`, `exists`, `existsBy`, `update`, `delete`, `softDelete`, `restore` and `createQueryBuilder`. It also offers `create`, `save` and `insert`, which are stamped by the subscriber.

- Array (`OR`) where clauses get the tenant on **every** branch. An empty array becomes "this tenant", not "everything".
- A where that names a different tenant (`{ tenantId: 'other' }`) throws `TenantMismatchError` instead of being rewritten. The same goes for an `update` that tries to move a row to another tenant.
- `update`, `delete`, `softDelete` and `restore` take a where object (or array), not a bare id: write `{ id }`.
- Methods that are not listed (`sum`, `increment`, `remove`, ...) are not exposed at all, so there is no unscoped back door by inheritance. Use `createQueryBuilder()` for them.
- Inserts are stamped and validated by `TenantSubscriber` on **any** insert path of the DataSource, including plain repositories.

## The bypass

Cross-tenant work is possible through exactly one function. It needs a reason, and logs it through the Nest `Logger` as a warning every time:

```ts
await withoutTenantScope('nightly billing job across all tenants', () => invoices.find());
```

```
WARN [TenantGuard] Tenant scope bypassed: nightly billing job across all tenants
```

- A blank reason throws a `TypeError`.
- Inside the callback nothing is scoped, stamped or validated, so inserts must name their tenant themselves.
- `runWithTenant(id, ...)` inside a bypass switches scoping back on, which makes "list the tenants, then work per tenant" safe.

## Errors

Both errors extend `Error` and carry typed fields. Map them in an exception filter if you want something other than a 500.

```
MissingTenantContextError: No tenant in the current context: refusing to run "find" on tenant-scoped
entity "Invoice". Make sure the request passes through TenantGuardModule's middleware (or
runWithTenant), or wrap deliberate cross-tenant work in withoutTenantScope(reason, fn).
  .entityName = 'Invoice', .operation = 'find'

TenantMismatchError: Tenant mismatch on "insert" for entity "Invoice": the current tenant is "acme"
but the operation names "globex". Use withoutTenantScope(reason, fn) if crossing tenants is intended.
  .entityName, .operation, .expectedTenantId, .actualTenantId
```

```ts
@Catch(MissingTenantContextError)
export class MissingTenantFilter implements ExceptionFilter {
  catch(_error: MissingTenantContextError, host: ArgumentsHost) {
    host.switchToHttp().getResponse().status(401).json({ message: 'Tenant required' });
  }
}
```

## Limits

This is application-level protection. It closes the "someone forgot the condition" hole for the paths it covers; it is not a database security boundary. Read this list before relying on it.

- **Raw SQL is not protected.** `dataSource.query`, `manager.query` and `queryRunner.query` are neither filtered nor stamped, even inside a tenant context. If you write raw SQL on a tenant-scoped table, add the tenant condition yourself. (`tests/raw-queries.spec.ts` documents this.)
- **Only this library's repositories are scoped.** A plain `@InjectRepository(Invoice)`, `dataSource.getRepository(Invoice)` or `manager.find(Invoice)` is not. Inserts are still stamped, reads and updates are not.
- **Joins and sub-queries are not scoped.** `relations` in find options and `leftJoin`/`innerJoin` or sub-queries in a query builder read the joined table without a tenant filter. Rows reached through a foreign key from a scoped row normally belong to the same tenant, but nothing here enforces that.
- **Query builder transitions.** `createQueryBuilder()` returns a scoped `SELECT`. Calling `.update()`, `.delete()`, `.softDelete()` or `.restore()` on it fails with a SQL error; use the repository methods of the same name.
- **Primary-key writes.** `save()` of an entity that already has an id updates by that id and is not tenant-checked. `remove`, `softRemove` and `recover` are not offered. Load entities through the scoped repository first.
- **Migrations, seeds and schema sync** run outside any request, so they have no tenant. Raw migration SQL is unaffected. Seed scripts that use the repositories need `runWithTenant` or `withoutTenantScope`.
- **Non-HTTP entry points** (queues, cron, sockets, microservices) get no middleware. Wrap them in `runWithTenant`.
- **Lost async context.** If code that clearly runs inside a request throws `MissingTenantContextError`, a library in between probably dropped the `AsyncLocalStorage` context (typically callback- or event-emitter-based code).
- **Tenant ids are non-empty strings**, compared strictly. The library does not check that a tenant exists.
- **Entities must be classes.** `EntitySchema` definitions cannot carry `@TenantScoped()`. Subclasses of a scoped entity inherit the scoping. The tenant column must be a top-level property.
- For defense in depth, add database-level isolation as well (for example PostgreSQL row-level security). This library does not replace it.

## How it works

- **Context.** A middleware resolves the tenant per request and runs the rest of the request inside `AsyncLocalStorage.run`. The tenant follows every `await`, is invisible to concurrent requests, and costs nothing per request, unlike request-scoped providers.
- **Scoping.** `TenantRepository` wraps a TypeORM repository. For each call it reads the context, merges the tenant into every branch of the where, and delegates. With no tenant and no bypass it throws before any SQL runs.
- **Query builders.** The tenant condition goes into TypeORM's `extraAppendedAndWhereCondition`, which TypeORM renders as `( your conditions ) AND ( tenant )`. A later `.where()` cannot wipe it and `OR` terms cannot escape it.
- **Insert.** `TenantSubscriber.beforeInsert` stamps the tenant on rows that do not name one and throws if a row names a different one.
- **Bypass.** `withoutTenantScope` opens a nested context flagged as bypassed; the repository and subscriber check that flag.

## Compatibility

Developed and tested against `@nestjs/common` 11, `typeorm` 0.3 and `better-sqlite3`. Other TypeORM-supported databases use the same code path, but only SQLite is exercised by the test suite.

## License

MIT © Mohamad Moaaz Allow
