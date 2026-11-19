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
