# ShopStream: React catalog and read-only DAB backend

This is a separate App Service Builder application root, not a replacement for
the repository-root Express/React app. It uses Data API builder **2.1.5** on
**.NET 10** against existing `dbo.products` and `dbo.categories` tables.
It creates no database, tables, seed data or migrations.

The same Builder app serves a React 18/Vite catalog at `/` and DAB at `/api`.
The UI provides complete-catalog search, category filters, price/rating sorting,
product details, incremental display and refresh. It has no checkout, order
management, review mutations or calls to the original Node.js API. The original
Node.js deployment is preserved on the `nodejs-azure-sql-serverless` branch.

Builder's Oryx detection requires a .NET project even with a custom build.
`DabBackend.csproj` is the actual MSBuild packaging entry point: its `PackageDab`
target installs the pinned official `Microsoft.DataApiBuilder` .NET tool into
the deployment output and copies the config. It does not compile another HTTP
server. The runtime starts DAB directly; there is no container sidecar or
custom HTTP wrapper. Select `dab-poc` as the
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
check startup, ingress authentication, actual SQL reads and write denial.

## Required configuration and security

- Set `ASPNETCORE_URLS=http://0.0.0.0:8080`.
- Set `SQL_CONNECTION_STRING` to a passwordless Azure SQL connection string:
  `Server=tcp:<existing-server>.database.windows.net,1433;Database=<existing-database>;Authentication=Active Directory Managed Identity;Encrypt=True;TrustServerCertificate=False;Connect Timeout=60;Min Pool Size=0;Max Pool Size=5;ConnectRetryCount=0;`.
- Assign the new app its own system-assigned identity. An SQL administrator
  must create a separate contained user using that identity's **client ID**
  as the SQL SID and grant SELECT only on the two exposed tables. Do not reuse
  the Express app's write-capable user or identity.
- Require Microsoft Entra sign-in at Builder's ingress **before deployment**.
  DAB deliberately uses `Unauthenticated` with read-only `anonymous` permissions
  behind that boundary; it does not independently validate the visitor or apply
  per-user authorization. Do not deploy this configuration to a public ingress
  with authentication disabled. CORS is not an authentication mechanism.
- GraphQL, MCP, write actions and comprehensive SQL health checks are disabled.
  Builder's default compute probe uses `/`, DAB's basic service-info endpoint,
  without a database query. The public `/api` reachability probe can return 404;
  default reachability accepts 100-499, not just 200. It is not a SQL health check.
  Startup and actual reads still access SQL and can resume Serverless compute.
  Pool minimum zero does not prove that the database will auto-pause.

No customer/order/review data is exposed. SQL network access is still required;
this proof reuses the already approved networking for the existing database.

## API contract

After signing in through Builder:

```text
GET /                         React catalog UI
GET /api/products?$first=2     Product rows in DAB's value array
GET /api/products/id/1         Product with primary key 1
GET /api/categories?$first=2   Category rows
```

Filtering, ordering, selection and pagination use DAB query parameters, not the
Express API's response shapes or `limit`/`page` parameters. The separate catalog
adapts the product-browsing experience, not transactional order/review behavior.
Write attempts must fail at both DAB authorization and SQL permissions.

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
npm ci --prefix dab-poc\ui
npm test
npm run build --prefix dab-poc\ui
builder manifest validate dab-poc --json
```

`npm test` includes database-free DAB UI pagination/error/search tests.
`ui/src/main.jsx` is the React UI, `ui/src/catalog.mjs` adapts DAB responses,
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
local live read, use `Authentication=Active Directory Default` with a separate
SELECT-only Entra developer account and approved temporary network access.
Never use an administrator account to test runtime write denial.

For hosted verification, check the exact deployed revision, sign in through
Builder, read both entities, verify filtering/pagination and check that write
requests and disabled endpoints fail. A healthy `/` alone does not establish
database connectivity or authorization. With the UI installed, an HTML 200
at `/` proves only frontend delivery; check `/api/products` separately.

To try local source before pushing, create a ZIP with `builder.yaml` at its
root, plus `DabBackend.csproj`, `dab-config.json`, the UI source/package/lock
files and license. Exclude `.env`, Git metadata, `node_modules`, `dist` and
caches. Use the prepared-manifest CLI workflow:

```powershell
builder app deploy --name <existing-dab-app> --subscription <subscription> --resource-group <group> --source-archive <source.zip> --manifest dab-poc\builder.yaml --json
```

This deploys to the existing app and affects its serving version; it is not an
isolated preview slot. Confirm its GitHub source branch and `autoDeploy` state
before subsequently pushing. Do not start a duplicate manual deployment while
a push-triggered deployment is already running.

## Verified backend-only deployment (before the catalog UI)

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

## Verified UI deployment before Git push

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
