# ShopStream on Azure SQL Database Serverless

A multi-vendor e-commerce **DEV/TEST demo**, adapted from
[AzureAppService/app-service-builder-postgresql](https://github.com/AzureAppService/app-service-builder-postgresql)
at commit `d0008c9faea1be74b73977ec70654497f817a22d`. The original React 18
JavaScript/JSX UI, CSS, dashboard, searchable catalog, vendors, orders, reviews,
analytics and light/dark theme are retained. The backend now uses Express and
`mssql` (Tedious) with Azure SQL Database, not PostgreSQL.

The original Microsoft MIT license is preserved in [LICENSE.md](LICENSE.md).
The screenshots in `docs/images` come from upstream; they are illustrative,
not evidence of an Azure SQL deployment or live database test.

## What this creates

`infra/main.bicep` provisions an Entra-only logical SQL server and a **General
Purpose Serverless** database: `GP_S_Gen5`, maximum 2 vCores, minimum 0.5 vCores,
60-minute auto-pause and 2 GiB maximum data size. Bootstrap requires database
compatibility level 160 or newer (the default for a new Azure SQL database).
This is not a DTU, provisioned-compute, Managed Instance or PostgreSQL sample.
Confirm regional capacity, subscription permissions and current pricing before
deploying. Storage/backups and the web app can still incur charges when SQL
compute is paused. Nothing in installation, tests or app startup deploys Azure
resources.

The database has 2,525 fictional seed rows: 10 vendors, 15 categories, 500
products, 200 customers, 300 orders, 900 order items, 400 reviews and 200 inventory
events. No real customer data or database credentials are included.

## How to read the code

Start with one request rather than reading every file in directory order:

1. Read [db/schema.sql](db/schema.sql) for the eight business tables, foreign
   keys and indexes. Vendors/categories describe products; customers place
   orders with order items; reviews and inventory events reference products.
   Prices are integer cents and timestamp defaults are UTC.
2. Read [server/index.js](server/index.js) for middleware, API mounts, static
   frontend serving and shutdown. It starts the app, not database setup.
3. Trace the dashboard: [Dashboard.jsx](client/src/pages/Dashboard.jsx) calls
   `fetchDashboard` in [api.js](client/src/api.js), which requests
   `/api/dashboard`. [The route](server/routes/dashboard.js) calls
   `getDashboardStats` in [queries.js](server/db/queries.js), then shapes SQL
   recordsets into the JSON the page renders. [useApi](client/src/hooks/useApi.js)
   manages loading, errors and explicit refresh.
4. Read [config.js](server/db/config.js) and [pool.js](server/db/pool.js) for
   authentication, verified TLS, shared connections and bound `@p1` parameters.
   SQL is written directly; there is no ORM or generated data model.
5. Trace `POST /api/orders` in [orders.js](server/routes/orders.js) for the
   business rules: combine duplicate products, check stock/limits, calculate
   totals, then write the order, items, stock and inventory events atomically.
   [transaction.js](server/db/transaction.js) provides the cross-replica SQL
   application lock and commit/rollback behavior.
6. Read [demoWrites.js](server/middleware/demoWrites.js),
   [validation.js](server/validation.js) and [errorHandler.js](server/middleware/errorHandler.js)
   for write restrictions, input checks and safe error responses. Follow with
   the corresponding [tests](test), especially `orders.test.js`,
   `transaction.test.js` and `routes.test.js`.

[App.jsx](client/src/App.jsx) selects the frontend page; shared visual components
are under `client/src/components`. [builder.yaml](builder.yaml) and
[scripts/package.js](scripts/package.js) describe building and packaging the app.
Database creation and setup are a separate path through `infra/main.bicep` and
`db/setup.js`, described below.

## Prerequisites and install

Use **Node.js 24**, npm, Azure CLI and an Azure SQL Entra administrator for setup.
Use a separate limited principal for the application. This repository does not
create a GitHub remote, GitHub repository or deployment automatically.

```powershell
npm ci
Copy-Item .env.example .env
```

`.env` is ignored. Node does not load it automatically: use `--env-file=.env`
as shown below. Never put tokens, passwords or resource-specific private values
in committed files. Build steps need no database access.

## 1. Provision the dedicated Serverless database (optional, billable)

The following is a reusable operator-run example, not a command that
installation runs automatically. Choose your own resource group, location,
unique server name and administrator. Use an existing approved resource group
or create one separately. A separately verified deployment is recorded
[below](#verified-deployment-snapshot).

```powershell
az login --tenant <tenant-id>
az account set --subscription <subscription-id>
az bicep build --file infra\main.bicep --stdout
az deployment group create --resource-group <dev-test-group> --template-file infra\main.bicep --parameters serverName=<unique-server-name> administratorObjectId=<admin-object-id> administratorName=<admin-upn> location=<approved-region>
```

The firewall starts **closed**, with no "Allow Azure services" rule. Add only
approved developer and app outbound IPv4 addresses using the
`allowedClientIpAddresses` template parameter or Azure SQL networking controls.
Do not open a broad Internet range. The special `0.0.0.0` "Allow Azure services"
rule is broader than access from your app alone; it is not the default and
requires explicit approval for a dedicated demo server. See the
[Builder networking limitations](docs/connection-automation.md#network-access)
before assuming fixed outbound IPs or private connectivity.
Allow the applicable Azure SQL connection-policy ports through your outbound network; consult
[Azure SQL connectivity](https://learn.microsoft.com/azure/azure-sql/database/connectivity-architecture).
Private endpoints require separately configured networking and DNS; Builder
does not create that route. No credentials or firewall bypass are fallbacks.

Set `SQL_SERVER=<server>.database.windows.net`, `SQL_DATABASE=shopstream` and
`ENTRA_CREDENTIAL=default` in your private `.env`. For local development,
Tedious uses **DefaultAzureCredential**, which can use your Azure CLI login.
Remove unrelated service-principal credential environment variables so the
credential chain does not select an unintended identity. Select the intended
tenant/subscription with `az login --tenant` and `az account set`.

## 2. Bootstrap schema and seed as an administrator

```powershell
node --env-file=.env db\setup.js bootstrap
```

This is the only supported way to install `db/schema.sql` and `db/seed.sql`.
It requires an empty, dedicated database and installs everything in one
transaction with a version marker. Re-running bootstrap preserves existing
sample data. An unmarked non-empty database, empty existing marker or unknown
version is rejected. Compatibility level **160 or newer** is needed for
`GENERATE_SERIES` and `DATETRUNC`; bootstrap checks it before changing data.
For an older existing empty database, an administrator must first run
`ALTER DATABASE [shopstream] SET COMPATIBILITY_LEVEL = 160` in their SQL tool.

Reset is **administrator-only**, deletes the sample data and reseeds SQL
`IDENTITY` counters. It does not rebuild tables or apply schema changes.
Make sure no external objects reference these sample tables. It uses the same
SQL application lock as runtime mutations, not a web reset endpoint:

```powershell
$env:SHOPSTREAM_CONFIRM_RESET = 'shopstream' # exact dedicated database name
node --env-file=.env db\setup.js reset
Remove-Item Env:\SHOPSTREAM_CONFIRM_RESET
```

The HTTP `/api/reset` endpoint always returns 403. Startup and build never
bootstrap, reset or seed the database.

### Schema ownership and upgrades

This is **SQL-first bootstrap, not a migration system**:

| File or component | Responsibility |
| --- | --- |
| `infra/main.bicep` | Create the SQL server/database and Serverless settings, not application tables |
| `db/schema.sql` | Define the initial eight business tables, constraints and indexes |
| `db/seed.sql` | Populate the fictional demo data |
| `db/setup.js bootstrap` | Install schema/seed and the `dbo.shopstream_bootstrap` version-1 marker in one transaction |
| `db/setup.js grant` | Map a separate runtime identity and grant limited data permissions |
| `builder.yaml` | Build and run the web app, without database setup |

Bootstrap uses the same transaction-owned SQL application lock as runtime
mutations. Once a valid version-1 marker exists, it skips installation without
comparing the live tables to `schema.sql`. Editing that file, rerunning bootstrap
or redeploying the app therefore **does not upgrade an existing schema or detect
manual schema changes**. Changing the marker to another version only causes the
current code to reject it; it does not supply an upgrade path.

For ongoing schema evolution, add an explicit versioned migration process:
track applied SQL changes, run them with a separate deployment identity, and
apply backward-compatible changes before deploying the app that needs them.
For example, add a nullable column before code starts using it; backfill and
tighten constraints in later changes if necessary. The running app must retain
its limited data permissions rather than creating or altering tables.
Rolling back application code does not roll back database changes.
**No migration runner or automatic schema-deployment stage is implemented yet.**

## 3. Grant the runtime identity only sample permissions

Enable the web app's system-assigned managed identity, then obtain its **client/
application ID**. For this `CREATE USER WITH SID` form, SQL maps applications and
managed identities by client ID, not object/principal ID. For local development, use a
separate non-administrator Entra user and its object ID. While still connected
as the administrator:

```powershell
$env:RUNTIME_ROLE = 'shopstream_runtime'
$env:RUNTIME_CLIENT_ID = '<app-managed-identity-client-id>'
$env:RUNTIME_OBJECT_TYPE = 'service'
node --env-file=.env db\setup.js grant
Remove-Item Env:\RUNTIME_ROLE, Env:\RUNTIME_CLIENT_ID, Env:\RUNTIME_OBJECT_TYPE
```

For a developer user or group, set `RUNTIME_OBJECT_TYPE=user` or `group` and
`RUNTIME_OBJECT_ID=<user-or-group-object-id>` instead of `RUNTIME_CLIENT_ID`.
This distinction applies to raw SQL SID provisioning, not Azure RBAC grants,
which still identify the managed identity by its object/principal ID.

The setup uses `CREATE USER ... WITH SID ..., TYPE = E/X` to map the exact Entra
client ID (applications/managed identities) or object ID (users/groups) without
a directory-name lookup. Re-running grants checks the existing
SID/type instead of replacing it. The script refuses role membership or schema
ownership on the runtime user. Use a fresh dedicated database/principal: the
script does not remove other administrators' historical grants or group access.
Never use a SQL Entra administrator or an administrator group as runtime identity.

Granted operations: SELECT on sample tables; INSERT on orders, order items,
reviews and inventory events; selected stock/rating/order-status UPDATE columns;
DELETE on reviews only. No schema creation, database ownership, bootstrap-marker
access or reset permissions are granted. Azure RBAC does not grant SQL data
access. Repeat with a different role name and the user's object ID for a limited developer.

## 4. Run locally

Sign out of the administrator account and use your limited developer account.
Keep `ENTRA_CREDENTIAL=default` in `.env`. Your current public IP must have
approved SQL firewall access; the deployed demo's temporary setup-IP rule was
removed after provisioning. Allow only your exact IP for local work and remove
that exception afterwards. Then run:

```powershell
npm run build
node --env-file=.env server\index.js
```

Open `http://localhost:8080`. For frontend hot reload, run
`npm run dev --prefix client` in another terminal and start the backend with
`node --env-file=.env --watch server\index.js`. Vite proxies `/api` to port 8080.
Use the frontend URL printed by Vite for hot reload.
The plain `npm start`, `npm run dev` and `npm run db:*` scripts do not load
`.env` themselves; use the explicit Node commands shown here, or export the
required variables into the shell first.

`/health/live` checks only the process and does **not** connect to SQL.
`/health` performs a real SQL query and returns 503 when unavailable, including
during resume. The UI shows read errors and allows an explicit Retry.

With the backend running, check:

```powershell
Invoke-RestMethod http://localhost:8080/health/live
Invoke-RestMethod http://localhost:8080/health
Invoke-RestMethod 'http://localhost:8080/api/products?limit=1'
```

Only the first check is database-free. The other two can resume SQL compute
and incur charges; a 503 during resume is not a reason to reset the database.

Writes are off by default. To enable bounded, **unauthenticated** local demo
writes, set `SHOPSTREAM_ENABLE_DEMO_WRITES=true` in `.env` and restart. This is
not production authentication. Before enabling hosted writes, enforce a trusted
visitor access policy and set `SHOPSTREAM_PUBLIC_ORIGIN` to the exact public
HTTPS origin (no trailing slash/path/query). Origin checks are not user
authentication, and clients without an Origin header can still make requests.
Forwarded host/protocol headers never authorize writes.

Orders combine duplicate product IDs, check quantities/stock and update orders,
items, inventory and stock atomically. Mutations serialize across replicas via
transaction-owned `sp_getapplock` and use row update locks. Limits include seed
data: **1,000 orders, 1,000 reviews, 5,000 inventory events**. Reaching a limit
returns 409; no data is automatically removed. Status updates advance one step
from pending through delivered; reviews update the product's rating.

## Serverless pause, resume and connection behavior

The shared pool uses a maximum of five connections, **minimum zero**, and a
30-second idle timeout. TLS encryption and certificate validation are mandatory.
Hosted mode is `ENTRA_CREDENTIAL=managed-identity` (the default): Tedious uses
ManagedIdentityCredential, without falling back to a developer account. Leave
`AZURE_CLIENT_ID` unset for a system-assigned identity; set it to the assigned
user identity's client ID only when deliberately using a user-assigned identity.
Tedious acquires Entra tokens as physical connections authenticate; the app
does not cache one access token forever.

With no sessions/user CPU activity, General Purpose Serverless can pause after
the configured delay. A login to a paused database triggers resume; the initial
connection may fail (for example 40613) or take longer than usual. Connection
timeout is 60 seconds, query timeout 15 seconds. The app returns a sanitized 503;
it never replays SQL writes or retries a transaction automatically. After a
failed initial pool connection, a later request can make a new connection attempt.

Retry **reads** after the database resumes. After an uncertain write outcome,
read the relevant order/review first; a failed response is not proof the commit
failed. Do not blindly resubmit an order. This demo has no idempotency-key system.

Builder probes `/health/live` to avoid continuously waking SQL. External uptime
probes against `/health`, open SQL tools/sessions, frequent page/API traffic,
background jobs or other incompatible features can prevent pause or trigger
resume and charges. Never promise pause solely because `min=0` is configured.
See [Serverless overview](https://learn.microsoft.com/azure/azure-sql/database/serverless-tier-overview)
and [auto-pause/resume](https://learn.microsoft.com/azure/azure-sql/database/serverless-tier-auto-pause-resume).

## 5. Deploy the web app with App Service Builder

`builder.yaml` preserves the upstream single Node.js 24 web component.
`npm ci && npm run build && npm run package` builds React into `dist` and stages
a self-contained backend using Builder's `DESTINATION_DIR`. React/Vite stay
under `client`, not the root package. Do not add root Vite framework evidence,
set the reserved `PORT`, or put database credentials in frontend `VITE_*` values.

`infra/app.bicep` optionally creates a **new source-less** Builder App with
system-assigned identity and 0-2 HTTP replicas in the upstream-supported
`westus2` region. Do not apply it over an existing configured app. Configure
source separately, grant the committed identity using step 3, then set the
following runtime values and deploy the reviewed source:

| Variable | Value |
| --- | --- |
| `SQL_SERVER` | `<server>.database.windows.net` |
| `SQL_DATABASE` | `shopstream` |
| `SQL_PORT` | `1433` (optional) |
| `ENTRA_CREDENTIAL` | `managed-identity` |
| `SHOPSTREAM_ENABLE_DEMO_WRITES` | `false` initially |
| `SHOPSTREAM_PUBLIC_ORIGIN` | Exact public HTTPS origin, only for enabled trusted demo writes |

Alternatively, `connection.json` is the passwordless **azureSql named-connection**
template, mapping `connectionString` to `SQL_CONNECTION_STRING`. The app uses
the driver's native parser for routing only and enforces its own Entra/TLS
configuration. Use that setting **instead of** the three SQL routing variables,
not alongside them. The template selects a system-assigned identity and uses
the logical SQL server's full ARM resource ID. The database is selected in the
routing string. Named-connection availability depends on
the deployed Builder preview catalog; see [configuration steps](docs/connection-automation.md).
Saving a connection does not grant SQL access or test persistence.

After deployment, verify `/health/live`, then intentionally call `/health` and
read dashboard/products/orders. Check writes remain 403 by default. If approved
for a bounded demo, enable writes and record returned IDs; read the same order
after an app restart/redeployment to verify persistence. Disable writes again.
Do not bypass visitor authentication to make a probe pass. The
[deployment snapshot](#verified-deployment-snapshot) separates the checks
actually performed from those still outstanding.

## Checks

```powershell
npm test
npm run build
az bicep build --file infra\main.bicep --stdout
az bicep build --file infra\app.bicep --stdout
```

`npm test` is database-free and does not need `.env`, Azure sign-in or a running
web server. `npm run build` installs frontend dependencies and builds assets;
it does not connect to SQL or install the schema. CI in
[validate.yml](.github/workflows/validate.yml) runs these checks, packages the
app and compiles the infrastructure templates; it does not deploy Azure
resources or run live database integration tests.

Offline tests cover input/origin checks, pool reuse/failure recovery, parameter
binding, transactional success/failure, cumulative write limits, bootstrap/reset
checks and principal mapping. They do **not** execute T-SQL or authenticate to
Azure. With a dedicated seeded disposable database, approved exact-IP network
access and the **limited** runtime/developer identity, explicitly opt in to the
real CRUD/persistence test. First point your private `.env` at that disposable
database, not the deployed demo or any production database:

```powershell
$env:SHOPSTREAM_INTEGRATION_DB = 'shopstream_test' # must match disposable SQL_DATABASE in .env
node --env-file=.env --test test\integration\crud.test.js
Remove-Item Env:\SHOPSTREAM_INTEGRATION_DB
```

It leaves an order/stock change for restart-persistence assertions and deletes
its own review on the normal success path; interrupted or failed runs can leave
additional test data. The test starts its own loopback backend on port 8187
(`SHOPSTREAM_TEST_PORT` can select another port), explicitly enables bounded
writes in that child process and restarts it to check persistence. It is not
part of `npm test`. The bare `npm run test:integration` script requires settings
already exported into the shell; the explicit Node command above loads `.env`.
Reset only with the administrator against the dedicated test database afterwards.
Live checks are required before relying on concurrent stock behavior, Entra
token renewal or resume latency; offline test doubles cannot prove them.

## Verified deployment snapshot

Recorded **2026-11-19 UTC**. This is historical evidence for the revision below,
not a continuous-health guarantee or a promise that another target will work.
These resources were provisioned explicitly, not by build or application startup.

| Item | Verified value |
| --- | --- |
| Runtime URL | https://shopstream-azuresql-saurabh-bf210a64.app.westus2.builderapps.dev |
| Source | `saurabh500/app-service-builder-postgresql`, branch `dev/saurabh/azure-sql-serverless-app` |
| Deployed commit | [`fa3aa915c6cabffc1d594675110a77f5f04f62e2`](https://github.com/saurabh500/app-service-builder-postgresql/commit/fa3aa915c6cabffc1d594675110a77f5f04f62e2) |
| Active version at verification | `ver_20261119_cc3b696c61b2` |
| Resource group / region | `appbuilder-saurabh` / `westus2` |
| Builder app | `shopstream-azuresql-saurabh`, system-assigned managed identity, 0-2 HTTP replicas |
| SQL logical server | `shopstream-saurabh-azsql-1118.database.windows.net`, Entra-only |
| Databases created | `shopstream` and automatic system database `master` |
| Application database settings | `GP_S_Gen5_2`, 0.5-2 vCores, 60-minute auto-pause, maximum 2 GiB |
| Runtime SQL principal | `shopstream_runtime_mi`, mapped using the app identity's client ID |

The approved special `AllowAzureServices` firewall rule remains on this dedicated
server because the Builder preview did not provide fixed outbound IPs or VNet
integration. It admits a broader Azure network boundary than this app alone;
SQL authentication and permissions still apply. The temporary exact-IP setup
rule was removed. Existing unrelated resources were not modified.

| Check actually performed | Result |
| --- | --- |
| Node.js 24 offline tests and frontend build | 25 tests passed; build passed |
| Schema/seed bootstrap and repeated bootstrap | 2,525 fictional rows; rerun preserved data |
| Repeated runtime grants | Reused the same verified mapping |
| Fresh managed-identity connection in deployed replica | Connected as `shopstream_runtime_mi`; SELECT allowed, CREATE TABLE and inventory ALTER denied |
| Browser dashboard and SQL-backed read APIs | Rendered seeded data; health, config, dashboard, product list/search/detail, order list/detail, vendors, categories and analytics returned 200 |
| Default write and reset checks | POST orders and reset returned 403 |
| Platform visitor authentication | Retained; anonymous command-line probes returned 401 |

Not exercised: the opt-in live CRUD/process-restart test, real concurrent stock
contention, observed SQL auto-pause/resume and long-duration identity-token
renewal. Demo writes remained disabled. The checks above must not be read as
evidence for those cases.

## DAB status

The repository-root application still uses Express and `mssql`.
A separate [DAB inventory and fulfillment app](dab-poc/README.md) under `dab-poc`
packages Data API builder 2.1.5 as the single .NET 10 HTTP backend of another
Builder app, using existing read-only product/category tables and a separate
identity. Its React UI supports receive/adjust/reserve/release operations through
one transactional SQL procedure, SQL-owned warehouse roles, row-level security,
durable request receipts and movement history in an independent `inventory`
schema. The same app retains a catalog UI adapted to DAB's product/category APIs;
it does not replace the original dashboard,
checkout or order/review behavior. The exact deployed Node.js baseline is
preserved on `nodejs-azure-sql-serverless`.

DAB does not replace SQL migrations or automatically preserve the order/review
business rules. This experiment uses generic .NET hosting, not a turnkey DAB
integration or a sidecar. Its deployment and authentication need to be verified
on each target. See the [DAB overview](https://learn.microsoft.com/azure/data-api-builder/overview)
and [Builder runtime reference](https://builder.appservice.azure.com/docs/reference/runtimes/).
