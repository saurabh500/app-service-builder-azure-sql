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

The following is an operator-run example, **not an action already performed**.
Choose your own resource group, location, unique server name and administrator.
Use an existing approved resource group or create one separately.

```powershell
az login --tenant <tenant-id>
az account set --subscription <subscription-id>
az bicep build --file infra\main.bicep --stdout
az deployment group create --resource-group <dev-test-group> --template-file infra\main.bicep --parameters serverName=<unique-server-name> administratorObjectId=<admin-object-id> administratorName=<admin-upn> location=<approved-region>
```

The firewall starts **closed**, with no "Allow Azure services" rule. Add only
approved developer and app outbound IPv4 addresses using the
`allowedClientIpAddresses` template parameter or Azure SQL networking controls.
Never use `0.0.0.0` or a broad Internet range. Allow the applicable Azure SQL
connection-policy ports through your outbound network; consult
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

Reset is **administrator-only**, deletes the sample data and reseeds identities.
Make sure no external objects reference these sample tables. It uses the same
SQL application lock as runtime mutations, not a web reset endpoint:

```powershell
$env:SHOPSTREAM_CONFIRM_RESET = 'shopstream' # exact dedicated database name
node --env-file=.env db\setup.js reset
Remove-Item Env:\SHOPSTREAM_CONFIRM_RESET
```

The HTTP `/api/reset` endpoint always returns 403. Startup and build never
bootstrap, reset or seed the database.

## 3. Grant the runtime identity only sample permissions

Enable the web app's system-assigned managed identity, then obtain its **object/
principal ID**, not its client/application ID. For local development, use a
separate non-administrator Entra user and its object ID. While still connected
as the administrator:

```powershell
$env:RUNTIME_ROLE = 'shopstream_runtime'
$env:RUNTIME_OBJECT_ID = '<app-managed-identity-object-id>'
$env:RUNTIME_OBJECT_TYPE = 'service' # user for a developer, group for a group
node --env-file=.env db\setup.js grant
Remove-Item Env:\RUNTIME_ROLE, Env:\RUNTIME_OBJECT_ID, Env:\RUNTIME_OBJECT_TYPE
```

The setup uses `CREATE USER ... WITH SID ..., TYPE = E/X` to map the exact Entra
object ID without a directory-name lookup. Re-running grants checks the existing
SID/type instead of replacing it. The script refuses role membership or schema
ownership on the runtime user. Use a fresh dedicated database/principal: the
script does not remove other administrators' historical grants or group access.
Never use a SQL Entra administrator or an administrator group as runtime identity.

Granted operations: SELECT on sample tables; INSERT on orders, order items,
reviews and inventory events; selected stock/rating/order-status UPDATE columns;
DELETE on reviews only. No schema creation, database ownership, bootstrap-marker
access or reset permissions are granted. Azure RBAC does not grant SQL data
access. Repeat with a different role name and object ID for a limited developer.

## 4. Run locally

Sign out of the administrator account and use your limited developer account.
Keep `ENTRA_CREDENTIAL=default` in `.env`, then run:

```powershell
npm run build
node --env-file=.env server\index.js
```

Open `http://localhost:8080`. For frontend hot reload, run
`npm run dev --prefix client` in another terminal and start the backend with
`node --env-file=.env --watch server\index.js`. Vite proxies `/api` to port 8080.

`/health/live` checks only the process and does **not** connect to SQL.
`/health` performs a real SQL query and returns 503 when unavailable, including
during resume. The UI shows read errors and allows an explicit Retry.

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
No live Azure SQL or hosted deployment result is claimed by this repository.

## Checks

```powershell
npm test
npm run build
az bicep build --file infra\main.bicep --stdout
az bicep build --file infra\app.bicep --stdout
```

Offline tests cover input/origin checks, pool reuse/failure recovery, parameter
binding, transactional success/failure, cumulative write limits, bootstrap/reset
checks and principal mapping. They do **not** execute T-SQL or authenticate to
Azure. With a dedicated seeded disposable database and the **limited** runtime/
developer identity, explicitly opt in to the real CRUD/persistence test:

```powershell
$env:SHOPSTREAM_INTEGRATION_DB = 'shopstream' # must match configured database
node --env-file=.env --test test\integration\crud.test.js
Remove-Item Env:\SHOPSTREAM_INTEGRATION_DB
```

It leaves an order/stock change for restart-persistence assertions and deletes
its own review. Reset only with the administrator against the dedicated test
database afterwards. Live checks are required before relying on SQL permissions,
seed/schema execution, concurrent stock behavior, Entra token renewal, resume
latency or Builder network access.
