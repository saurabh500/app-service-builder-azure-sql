# Read-only DAB backend proof of concept

This is a separate App Service Builder application root, not a replacement for
the repository-root Express/React app. It uses Data API builder **2.1.5** on
**.NET 10** against existing `dbo.products` and `dbo.categories` tables.
It creates no database, tables, seed data or migrations.

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
an explicit health endpoint. This proof follows the same runtime contract.
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
  Builder probes `/`, DAB's basic service-info endpoint, without a database query.
  Startup and actual reads still access SQL and can resume Serverless compute.
  Pool minimum zero does not prove that the database will auto-pause.

No customer/order/review data is exposed. SQL network access is still required;
this proof reuses the already approved networking for the existing database.

## API contract

After signing in through Builder:

```text
GET /                         Basic service information
GET /api/products?$first=2     Product rows in DAB's value array
GET /api/products/id/1         Product with primary key 1
GET /api/categories?$first=2   Category rows
```

Filtering, ordering, selection and pagination use DAB query parameters, not the
Express API's response shapes or `limit`/`page` parameters. This does not migrate
the existing ShopStream frontend or transactional order/review behavior.
Write attempts must fail at both DAB authorization and SQL permissions.

Pagination uses DAB's native `next-link-relative` option. Its default absolute
links used Builder's internal proxy hostname in the first running deployment.
Relative links keep subsequent requests on the public authenticated origin;
clients should resolve `nextLink` against the API origin.
The option is defined in DAB 2.1.5's
[pagination configuration](https://github.com/Azure/data-api-builder/blob/v2.1.5/src/Config/ObjectModel/PaginationOptions.cs).

## Local checks

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
database connectivity or authorization.

## Verified hosted deployment

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
