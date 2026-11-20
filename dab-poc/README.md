# ShopStream: DAB inventory and fulfillment control center

This is the App Service Builder source root for this branch. It uses Data API builder **2.1.5** on
**.NET 10** against existing `dbo.products` and `dbo.categories` tables, with
an additional, independently migrated `inventory` schema.

The same Builder app serves a React 18/Vite operations UI at `/` and DAB at `/api`.
It supports warehouse-scoped availability, receive/adjust/reserve/release
commands, recent reservations and movement history. The original complete-catalog
search, filters, sorting and product details remain below the operations screen.
It has no checkout, order
management, review mutations or calls to the original Node.js API. The original
Node.js deployment is preserved on the `nodejs-azure-sql-serverless` branch.

Builder's Oryx detection requires a .NET project even with a custom build.
`DabBackend.csproj` is the actual MSBuild packaging entry point: its `PackageDab`
target installs the pinned official `Microsoft.DataApiBuilder` .NET tool into
the deployment output, compiles the small `host` entry point against those exact
binaries, and copies the config and launch script. The entry point registers the
inventory request-header check and calls the official DAB CLI in-process. It does not implement
another HTTP server. There is no container sidecar. Select `dab-poc` as the
Builder app's GitHub source `--root-directory`.

### Comparison with the official .NET sample

The [Builder .NET sample](https://github.com/AzureAppService/app-service-builder-dotnet)
uses `Microsoft.NET.Sdk.Web`, `TargetFramework=net10.0`, manifest
`platform: dotnet` / `platformVersion: "10"`, an HTTP listener on port 8080 and
an explicit health endpoint. This proof follows the same .NET runtime contract,
but uses Builder's default reachability probes: DAB's non-SQL liveness is `/`
on the compute, while the public compute mount is `/api`. No SQL query is
added merely to manufacture an API-prefixed health endpoint.
The difference is the build output: the sample publishes its own ASP.NET
application; our custom MSBuild target packages the official DAB .NET tool and
configuration, and the startup command runs DAB itself.

[Oryx](https://github.com/microsoft/Oryx) is the source-detection/build engine
used by Builder. It still needs a detectable .NET project before it runs a
custom build command. The first hosted attempt without that project failed
at detection, before DAB started. The packaging project supplies the framework
declaration and owns the real packaging operation; it is not another API server.
See [Builder's custom-build contract](https://builder.appservice.azure.com/docs/guides/builder-yaml/#override-the-build-correctly).
Neither comparison nor local manifest validation proves hosted readiness:
check startup, ingress authentication, actual SQL reads and unauthorized write denial.

## Required configuration and security

- Set `ASPNETCORE_URLS=http://0.0.0.0:8080`.
- Set `SQL_CONNECTION_STRING` to a passwordless Azure SQL connection string:
  `Server=tcp:<existing-server>.database.windows.net,1433;Database=<existing-database>;Authentication=Active Directory Managed Identity;Encrypt=True;TrustServerCertificate=False;Connect Timeout=60;Min Pool Size=0;Max Pool Size=5;ConnectRetryCount=0;`.
- Assign the new app its own system-assigned identity. An SQL administrator
  must create a separate contained user using that identity's **client ID**
  as the SQL SID. Grant SELECT on the two catalog tables, then use the inventory
  grant commands below for six read views and one procedure. Do not reuse
  the Express app's write-capable user or identity.
- Require Microsoft Entra sign-in at Builder's ingress **before deployment**.
  The updated configuration uses DAB's `AppService` provider and `authenticated`
  permissions. It trusts the principal headers that Builder verifies,
  strips from incoming requests, and replaces. Set `WEBSITE_AUTH_ENABLED=true`
  for the provider's production-mode check only when that protected ingress is
  actually enabled. This variable does not turn on authentication.
  Never expose a direct route around that proxy, use this setup on an
  unprotected host, or trust client-supplied identity headers.
  The deployment snapshots below predate this authentication change.
- GraphQL, MCP, generic table/view writes and comprehensive SQL health checks are disabled.
  The only write endpoint is an authenticated POST executing the bounded
  `inventory.execute_command` procedure; SQL independently checks warehouse roles.
  Builder's default compute probe uses `/`, DAB's basic service-info endpoint,
  without a database query. The public `/api` reachability probe can return 404;
  default reachability accepts 100-499, not just 200. It is not a SQL health check.
  Startup and actual reads still access SQL and can resume Serverless compute.
  Pool minimum zero does not prove that the database will auto-pause.

The native hosting-startup filter requires `X-Inventory-Command: 1` for unsafe
HTTP methods. Native DAB accepts JSON in a `text/plain` body, so requiring JSON
in the UI alone would not prevent cross-site form submissions. HTML forms
cannot supply this header; cross-origin JavaScript needs a preflight that the
empty CORS allowlist does not authorize. The same-origin UI sends it explicitly.
This is a small middleware check inside DAB's existing ASP.NET pipeline, not
another HTTP server. Keep it with the protected ingress and closed CORS policy.

No customer/order/review data is exposed. SQL network access is still required;
this sample reuses the already approved networking for the existing database.

## Database prerequisites

Use an existing ShopStream Azure SQL database with populated `dbo.products` and
`dbo.categories`. For a **new, empty** DEV/TEST database, follow the
[pinned Node branch's Serverless provisioning and catalog bootstrap instructions](https://github.com/saurabh500/app-service-builder-postgresql/blob/fa3aa915c6cabffc1d594675110a77f5f04f62e2/README.md#1-provision-the-dedicated-serverless-database-optional-billable).
This branch's [`infra/main.bicep`](../infra/main.bicep) provides the same Entra-only
Serverless database template. Run only the catalog bootstrap steps from a
separate checkout of the pinned revision; do not grant its runtime permissions
or deploy its Express app. Skip bootstrap for an existing populated catalog.

The template defaults to 0.5–2 vCores and 60-minute auto-pause. Open connections
can prevent pause, and the first SQL operation after pause can be slow or fail.
Retry reads after resume; do not automatically replay inventory writes.

## Inventory schema, RLS and administrator setup

The original `dbo` catalog stays unchanged. `db/inventory` adds warehouses,
SQL-owned memberships, balances, reservations, durable request receipts and
movements. The demo snapshot migration copies the active catalog's stock into two
independent demo warehouses. It is a one-time snapshot, not synchronization with
the Node.js application.

From the repository root, run `npm ci`. Use an authorized local Entra SQL
administrator, never the app identity. Use approved SQL network access and sign
in with `az login --tenant <tenant-id>`. Set the routing values in the environment
as shown below, or copy [`.env.example`](../.env.example) to `.env` and add
`--env-file=.env` before the script path in each `node` command.

```powershell
$env:SQL_SERVER='<existing-server>.database.windows.net'
$env:SQL_DATABASE='<existing-database>'
$env:ENTRA_CREDENTIAL='default'
$env:INVENTORY_CONFIRM_DATABASE=$env:SQL_DATABASE
$env:INVENTORY_TENANT_ID='<manager-tenant-guid>'
$env:INVENTORY_MANAGER_OBJECT_ID='<manager-user-object-guid>'
node db\inventory\setup.js migrate

$env:RUNTIME_ROLE='shopstream_dab_reader'
$env:RUNTIME_CLIENT_ID='<DAB-system-identity-client-guid>'
node db\inventory\setup.js grant-read
# Verify native caller identity and forged-header rejection through protected ingress first.
node db\inventory\setup.js grant-write
```

Before running `grant-read`, provision the external SQL user and grant catalog
reads as a SQL administrator in the target database. For example, use the DAB
system-assigned identity's client ID (not its object ID) in place of the GUID:

```sql
DECLARE @clientId uniqueidentifier = '<DAB-system-identity-client-guid>';
DECLARE @sid varchar(34) = CONVERT(varchar(34), CONVERT(binary(16), @clientId), 1);
EXEC (N'CREATE USER [shopstream_dab_reader] WITH SID = ' + @sid + N', TYPE = E;');
GRANT SELECT ON OBJECT::dbo.products TO [shopstream_dab_reader];
GRANT SELECT ON OBJECT::dbo.categories TO [shopstream_dab_reader];
```

Skip `CREATE USER` if the exact external mapping already exists.
On a fresh target, omit the `InventoryCommand` entity from the first deployment
while proving caller identity with read-only views. Restore it after `grant-write`:
the complete configuration needs procedure metadata visibility and EXECUTE.
The runner refuses mismatched principals, database roles, schema ownership
and permissions beyond the exact catalog/view/procedure allowlist. Do not use
the Node branch's runtime grant command for this identity: it grants unrelated
write operations. `grant-read` is additive, not a way
to revoke an earlier EXECUTE grant. To disable commands, revoke EXECUTE on
`inventory.execute_command` and remove its DAB entity.

Migration files are ordered, transactional and checksum-protected, with an
application lock and version ledger. Repeated migration calls do not reseed or
overwrite balances. Never edit an applied migration; add a new numbered one.
There is deliberately no runtime reset or membership-management API.
Inventory foreign keys protect referenced catalog products, so the original
database reset cannot delete them while inventory references remain. Plan an
explicit administrator teardown/migration rather than disabling constraints.
Additional memberships must be provisioned by a SQL administrator with
parameterized inputs; never accept warehouse roles from a browser.

RLS reads the exact AppService claim keys
`http://schemas.microsoft.com/identity/claims/tenantid` and
`http://schemas.microsoft.com/identity/claims/objectidentifier`, forwarded by
DAB's `set-session-context` option. Missing or malformed identities fail closed.
Warehouse membership scopes balances, reservations, history and warehouse reads;
receipts additionally belong to the submitting actor. A viewer can read,
operators can receive/reserve/release, and only managers can adjust stock.
The app has no direct INSERT/UPDATE/DELETE grants on inventory tables.
The procedure uses the caller's context, not `EXECUTE AS OWNER`.

Stock changes, reservations, receipts and movements commit together. Locked
balance reads prevent overselling; reservation rows serialize release;
transaction-owned request locks and a global request key prevent duplicate
application. Each command changes at most 10,000 units; on-hand stock remains
between reserved stock and 1,000,000 across successive calls.
Adjustment reasons are required; all reasons are limited to 200 UTF-16 code
units. Expected rejections such as insufficient stock have explicit outcomes.
An unexpected SQL failure rolls back and is surfaced, not replayed.

History is append-only for the runtime identity, not SQL Ledger or tamper-proof
against a SQL administrator. RLS depends on protected ingress and the trusted
runtime setting session context: it does not protect against a compromised app
identity with arbitrary SQL execution, or an administrator changing policies.

## API contract

After signing in through Builder:

```text
GET /                         Inventory and catalog UI
GET /api/products?$first=2     Product rows in DAB's value array
GET /api/products/id/1         Product with primary key 1
GET /api/categories?$first=2   Category rows
GET /api/access               Trusted SQL caller identity
GET /api/warehouses           Current caller's warehouses and roles
GET /api/availability         RLS-filtered warehouse/product balances
GET /api/reservations         RLS-filtered reservations
GET /api/movements            RLS-filtered movement history
GET /api/receipts              Current caller's scoped command receipts
POST /api/commands             One bounded inventory command
```

Filtering, ordering, selection and pagination use DAB query parameters, not the
Express API's response shapes or `limit`/`page` parameters. The separate catalog
adapts the product-browsing experience, not transactional order/review behavior.
Catalog and generic inventory CRUD attempts must fail at DAB and SQL permissions.

Send `Content-Type: application/json` and `X-Inventory-Command: 1`.
Example command body, with a new UUID for one logical operation:

```json
{
  "request_id": "11111111-1111-4111-8111-111111111111",
  "warehouse_id": 1,
  "action": "receive",
  "product_id": 1,
  "quantity": 5,
  "reservation_id": null,
  "reason": "Delivery received"
}
```

Use `receive`, `adjust`, `reserve` or `release`. For release, supply the existing
reservation ID and set product/quantity to null. No actor, tenant or role is
trusted from this body. DAB returns one row in `value` with `request_id`,
`warehouse_id`, `outcome`, `code`, `reservation_id`, `on_hand` and `reserved`.
HTTP 2xx alone does not mean success (native POST returns 201): inspect
`outcome` (`applied` or `rejected`).
With continuing access, the same request/payload returns the saved result;
changed payloads return `request_id_conflict`. Cross-actor key collisions can
surface as a SQL error and roll back, rather than exposing another actor's receipt.

The UI saves the exact pending request in account-scoped `sessionStorage` before
POST and checks the current SQL caller before writes/reconciliation. On an
unknown outcome it blocks new writes and offers receipt lookup or an explicit
retry of the **same** payload and ID. It never automatically retries writes.
An absent receipt is not proof of failure: the operation might still be running,
or warehouse access might have changed. After an uncertain retry, only a durable
accessible receipt resolves the original outcome. Keep the reference before
closing the tab; session storage is not a permanent cross-device work queue.

All warehouse balance pages are loaded before local search/filtering. The UI
honestly labels reservations and history as the latest 100, not complete history.
Movement timestamps are stored as UTC and displayed in the browser's local time;
the adapter accounts for DAB omitting the offset on SQL `DATETIME2` values.
Balance refresh replaces the snapshot; displaying more rows does not accumulate
another database snapshot.

SQL Serverless resume can exceed an HTTP timeout. Min pool size zero permits
idle connections to drain; neither that nor a reachability probe proves
auto-pause. After a timed-out POST, reconcile the original request rather than
issuing a new ID. This sample adds no write-retry framework and does not claim
that auto-pause/resume or long-duration identity renewal was exercised.

The UI reads active products in 100-row DAB pages with `$filter`, `$select` and
`$orderby`, follows every relative `nextLink`, and loads categories separately.
It then searches and sorts the complete in-memory snapshot; "Show more" reveals
12 additional cards, not another SQL query. This deliberately fits the small
fictional demo, not an arbitrarily large storefront. DAB 2.1.5 rejected the
tested `contains(name,'Running')` filter; client-side search is not presented as
a supported DAB string-search operator. For a large catalog, add a separately
reviewed SQL search view/API instead of loading the whole catalog.

The page loader rejects foreign-origin, wrong-resource and repeated next links.
Failed or expired-sign-in responses show an explicit error and retry/sign-in
actions, never an empty success or fabricated data. Refresh replaces the
snapshot; no automatic write or query-retry framework is added.

Pagination uses DAB's native `next-link-relative` option. Its default absolute
links used Builder's internal proxy hostname in the first running deployment.
Relative links keep subsequent requests on the public authenticated origin;
clients should resolve `nextLink` against the API origin.
The option is defined in DAB 2.1.5's
[pagination configuration](https://github.com/Azure/data-api-builder/blob/v2.1.5/src/Config/ObjectModel/PaginationOptions.cs).

## Local checks

From the repository root:

```powershell
npm ci
npm ci --prefix dab-poc\ui
npm test
npm run build
builder manifest validate dab-poc --json
dotnet run --project test\dab-host\DabHostTests.csproj --configuration Release
```

`npm test` includes database-free DAB pagination, command validation, caller
switching, pending-request and unknown-outcome tests, plus migration-runner tests.
`ui/src/Inventory.jsx` is the operations UI; `ui/src/inventory.mjs` adapts its API.
`ui/src/main.jsx` retains the catalog, `ui/src/catalog.mjs` shares safe page reads,
and `ui/src/styles.css` defines the responsive light/dark theme. The UI build
needs no database credentials. A plain local Vite server does not supply the
protected `/api` backend; live same-origin UI/API testing uses the deployed
Builder app. There is no mock-data fallback.

Install the pinned .NET tool in a disposable local tool directory with .NET 10:

```powershell
dotnet tool install --tool-path <local-tool-directory> Microsoft.DataApiBuilder --version 2.1.5
& <local-tool-directory>\dab.cmd validate --config dab-poc\dab-config.json
```

Validation connects to SQL and requires a `SQL_CONNECTION_STRING` environment
variable; it is not an offline-only schema check. Do not use
the hosted managed-identity connection string locally: an assigned Azure app
identity is not available on a developer machine. For an explicitly authorized
local validation, use `Authentication=Active Directory Default` with a separate
Entra developer account having the same narrow catalog/view/procedure permissions
and approved network access. A catalog-only reader cannot validate the complete
inventory procedure configuration.
Never use an administrator account to test runtime write denial.

The opt-in SQL test uses administrator-created, synthetic RLS fixtures, separate
physical sessions and cleanup; it is not a runtime-identity permission test.
Run it only against a disposable inventory database, never production:

```powershell
$env:INVENTORY_TEST_CONFIRM_DATABASE=$env:SQL_DATABASE
npm run test:integration
```

It exercises missing/malformed identity, role and warehouse isolation, competing
last-item reservations, duplicate/conflicting requests and releases, rollback,
RLS block predicates, repeated stock ceilings and unchanged original products.
It does not deliberately break locking or prove two real Entra users traversing
the hosted DAB connection pool.

An additional opt-in check uses the exact `Microsoft.Data.SqlClient` binary
packaged with DAB. It leases one physical SQL session three times and verifies
that both session-context claim keys reset on every lease. It changes no tables.
With the same confirmed database environment, use the directory containing the
packaged official `Microsoft.DataApiBuilder.deps.json`:

```powershell
$runtime='<DAB-runtime-directory>'
dotnet build test\inventory-pooling\InventoryPoolingTests.csproj --configuration Release --output $runtime "-property:DabToolDirectory=$runtime\."
dotnet exec --depsfile "$runtime\Microsoft.DataApiBuilder.deps.json" --runtimeconfig "$runtime\Microsoft.DataApiBuilder.runtimeconfig.json" "$runtime\InventoryPoolingTests.dll"
```

The `--keep-session-control` argument deliberately omits return/reset and must
fail on retained identity during the second round. That negative control
calibrates the check; this still is not a two-real-user HTTP identity-renewal test.

For hosted verification, check the exact deployed revision, sign in through
Builder, verify catalog and scoped inventory reads, a command plus its receipt,
duplicate/conflict behavior, forbidden CRUD and disabled endpoints. A healthy `/` alone does not establish
database connectivity or authorization. With the UI installed, an HTML 200
at `/` proves only frontend delivery; check `/api/products` separately.

To try local source before pushing, create a ZIP with `builder.yaml` at its
root, plus `DabBackend.csproj`, `dab-config.json`, `start-dab.sh`, the `host`
project/source, UI source/package/lock files and license. Exclude `.env`, Git
metadata, `node_modules`, `dist`, `bin`, `obj` and caches. Use the prepared-manifest CLI workflow:

```powershell
builder app deploy --name <existing-dab-app> --subscription <subscription> --resource-group <group> --source-archive <source.zip> --manifest dab-poc\builder.yaml --json
```

This deploys to the existing app and affects its serving version; it is not an
isolated preview slot. Confirm its GitHub source branch and `autoDeploy` state
before subsequently pushing. Do not start a duplicate manual deployment while
a push-triggered deployment is already running.

## Inventory verification, 2026-11-19 UTC

The inventory schema and four migrations were installed in the existing demo
database, and a repeated migration run was a no-op. No original product rows
changed: their full ordered JSON SHA-256 matched before and after the isolated
HTTP/UI checks. All three temporary verification warehouses and their related
rows were removed. The two demo warehouses remain.

Observed through the protected, signed-in app:

- SQL's caller view matched the actual Entra tenant/object claims. Forged
  principal headers did not change it; anonymous inventory reads, including
  forged-header requests, returned 401.
- Native DAB commands received stock, reserved and released units, and applied
  manager adjustments. Duplicate IDs did not reapply changes; changed payloads
  conflicted and a second release was rejected.
- A viewer and an unassigned warehouse could not receive stock; an operator
  could receive but not adjust. The unassigned warehouse was absent from reads.
  The runtime could execute the one procedure, but could not update stock or
  memberships directly or create tables.
- The actual React controls exercised receive/reserve/release/adjust. Switching
  from a manager warehouse to an operator warehouse reset the form operation,
  and complete-balance search found SKU 500.
- A browser check deliberately discarded a successful response **after SQL
  committed**. The UI saved the request, blocked another write, restored it on
  reload with zero automatic POSTs, and resolved it through a GET receipt lookup.
- Headerless JSON and plain-text write requests returned 403 from the native
  startup filter. An explicit client request reached DAB. An untrusted-origin
  preflight had no allowed-origin response header.

The local suite passed **42** offline tests and the production UI build. The
live SQL integration test covered isolation, role checks, competing reservations,
rollback and repeated bounds. The packaged SqlClient check reused one physical
session for three leases with cleared claim keys; deliberately keeping the
session without return/reset made its negative control fail as expected.
The host check passed both rejected and healthy calls twice. Native UTC timestamp
formatting was calibrated against the incorrect local-time parser in a non-UTC
timezone.

Not exercised: two real Entra users traversing the hosted pool, forced-broken SQL
locking, observed auto-pause/resume, sustained load, long-duration identity renewal
or a browser compatibility matrix. The narrow browser viewport had no horizontal
document overflow. Visual redesign is deferred; this rollout supplies the
functional operations screen, not a production-readiness claim.

## Historical backend-only deployment (before the catalog UI)

Observed on **2026-11-19 UTC**:

| Item | Value |
| --- | --- |
| App | `shopstream-dab-saurabh` |
| URL | <https://shopstream-dab-saurabh-8f107ed1.app.westus2.builderapps.dev> |
| Code revision | `1175037fbe4817b8b301afeaef47735f1814f8f5` |
| Active version | `ver_20261119_841be4373e5c` |
| Existing database | `shopstream` on `shopstream-saurabh-azsql-1118.database.windows.net` |
| SQL reader | `shopstream_dab_reader` |
| Identity client ID | `a17b5540-e7a0-4e72-b477-f339c60209d2` |
| Identity object ID | `13dd70dd-a44f-4b78-aebe-f037829e94ad` |

This added only a separate Builder app with its system-assigned identity and a
contained SQL reader; no SQL server, database, tables or seed data were created
for this proof. The reader has SELECT on the two catalog tables, no catalog
writes and no CREATE TABLE permission. The temporary local SQL firewall rule
was removed; only the previously approved `AllowAzureServices` rule remains.
That rule permits broad Azure-services network access, not just this app.

The final hosted checks exercised:

- Required Entra ingress authentication: anonymous catalog requests returned
  401; browser reads after the user's consent returned 200. The applied policy
  allows the configured tenant, not just the app owner. The old internal
  hostname also denied an unauthenticated catalog request with 403.
- Real SQL product/category reads, primary-key lookup, filtering, field
  selection and descending ordering.
- Two repeated pagination sequences for each entity: IDs 1/2 followed by 3/4,
  using the returned relative `nextLink` on the same public origin.
- A 100-row page succeeded; a request for 101 rows returned 400. This limit is
  per response, not a lifetime cap on how many rows a client may read.
- POST, PUT, PATCH and DELETE returned 403; product 1 was unchanged afterward.
  GraphQL, MCP and customer/order/review routes returned 404.

The origin check failed against the earlier running absolute-link deployment
and passed after enabling relative links. There was no separate mutation of
Builder's proxy behavior. The final config change also passed all 26 root
offline tests. The official DAB validator had previously connected to the
existing SQL database using the local setup identity; those earlier validation
results are distinct from the final hosted reader/ingress checks above.

The original ShopStream app remained on `ver_20261119_cc3b696c61b2`, and automatic
deployment is disabled for both apps. The existing frontend and transactional
order/review API were not migrated to DAB. Observed scale-to-zero, SQL
auto-pause/resume, sustained load and long-duration identity renewal were not
tested. Builder remains a preview/dev-test platform; this is not a production
readiness claim.

## Historical catalog UI deployment before Git push

On **2026-11-19 UTC**, the unpublished UI source was packaged explicitly
(no credentials, Git metadata, dependencies or generated output) and deployed
to the existing DAB app:

| Item | Value |
| --- | --- |
| Serving version | `ver_20261119_83c6c6f2e97a` |
| Deployment | `dep_20261119_83c6c6f2e97a` |
| Source kind | `uploadedArtifact`, not a Git commit deployment |
| Source ZIP SHA-256 | `0d4c0286c63ac1184bae7e97259c2bd8f466a6a91ca52497b2aff0d37d66d7b6` |
| UI | `/`, static React/Vite output built with Node.js 24 |
| Backend | `/api`, official DAB on .NET 10 |
| Configured GitHub branch | `dev/saurabh/azure-sql-serverless-app` |

The local frontend production build, all **31** root offline tests and Builder
manifest planning passed. The local build used Node.js 26 and emitted the
expected Node.js 24 engine warning; the successful hosted build targeted
Node.js 24. CI now also builds this separate UI using Node.js 24.

The authenticated live browser loaded **500 active products and 15 categories**
using five product pages and one category page. Search for `SKU-000500` found
the last product, and opening it showed its SKU, stock, price and description.
Clearing search, category filtering, descending price sort and showing 24
instead of 12 cards worked. Two complete refreshes each replaced the snapshot
with the same 500 rows using six API requests, with no accumulation.
The narrow browser viewport had no horizontal document overflow, and production
JS/CSS loaded successfully. A full desktop viewport and a browser compatibility
matrix were not exercised.

Anonymous requests to both `/` and `/api/products` returned 401.
POST/PUT/PATCH/DELETE remained 403, and product 1 stayed unchanged after those
denied requests. UI sign-in/error handling also has offline fake-response tests;
these do not prove actual long-duration identity renewal or SQL auto-resume.
No database grants, schema, data or app identity were changed for the UI.
The original Node.js app remained at `ver_20261119_cc3b696c61b2`.

The configured repository/branch and `rootDirectory: dab-poc` were retained
after the local upload. At this check, `autoDeploy` was false for both apps;
nevertheless, treat pushes as deployment-capable and inspect serving-version
changes rather than assuming a push cannot affect Azure.
