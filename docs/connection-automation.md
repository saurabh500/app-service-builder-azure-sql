# Configure Azure SQL access in App Service Builder

Provision SQL separately using `infra/main.bicep`, open only approved network
paths, bootstrap with a local Entra administrator, and grant the app identity
with `db/setup.js grant` as described in the README. No Azure operations run
automatically. SQL Serverless is billable; review current prices and preview
availability first.

The lifecycle is: create the app resource/identity, provision SQL, bootstrap
schema/seed as an administrator, grant the runtime identity, configure the
connection, then deploy application code. Creating the app resource is not a
code deployment. Saving a connection or deploying the app does not create or
upgrade tables. See [schema ownership and upgrades](../README.md#schema-ownership-and-upgrades)
for the current bootstrap-only behavior; no migration stage exists yet.

## Network access

The SQL template starts with a closed firewall. Local administrator setup and
local development/testing require an approved exact public-IP exception or a
separately supported private network path. Remove temporary client-IP rules
when finished. SQL authentication and data permissions are required in addition
to network access.

The Builder preview used for the verified deployment did not offer stable
outbound IPs or VNet integration. Do not copy a replica's observed IP into a
firewall rule and assume it will remain valid. For the dedicated demo server,
the operator explicitly approved SQL's special `0.0.0.0` "Allow Azure services"
rule. This is broader than access from this app alone and is not enabled by
the template. Do not enable it silently or use a broad Internet range as a
substitute; use only an approved networking arrangement supported by the target.

## Source-less app and identity

For a **new** Builder App only:

```powershell
az deployment group create --resource-group <app-group> --template-file infra\app.bicep --parameters appName=<unique-app-name>
```

Wait for its system-assigned identity to be committed; resolve its principal ID
to the **client/application ID** and use that as `RUNTIME_CLIENT_ID` in the
administrator grant step. For example, with the principal ID obtained from the
app's identity:

```powershell
az ad sp show --id <app-principal-id> --query appId --output tsv
```

This reads Entra metadata and does not grant SQL access. For user/group SQL
principals, use `RUNTIME_OBJECT_ID` instead, as documented in the README.
The app identity must not be a SQL administrator.
Configure GitHub source or use an explicitly prepared source
archive through Builder's supported deployment flow. Do not point Builder at
the PostgreSQL upstream or include private `.env` files.

## Routing variables (works without the named-connection preview)

Set `SQL_SERVER`, `SQL_DATABASE` and optional `SQL_PORT=1433` in Variables, plus
`ENTRA_CREDENTIAL=managed-identity`. Keep demo writes disabled. Save and deploy
the complete configuration. An optional exact `SHOPSTREAM_PUBLIC_ORIGIN` is a
separate control for explicitly enabled trusted demo writes, not SQL routing.
No variable belongs in the React bundle.

## Named connection alternative

Check the target's [connection catalog](https://builder.appservice.azure.com/docs/reference/arm-api/#read-connection-schemas-and-identity-outputs)
supports `azureSql`. Current documented profile fields require
`connectionString`, not PostgreSQL's host/user fields. In Portal Connections,
select the Azure SQL database and the already assigned system identity. Export
the passwordless SQL routing string as `SQL_CONNECTION_STRING`.

Copy `connection.json` into an ignored private `.local` directory and replace
the subscription, group, server and database placeholders. It is an ARM
**connection object**, not an entire app resource or an arbitrary CLI flag.
The destination `resourceId` identifies the logical SQL server, not its child
database; the database name belongs in `connectionString`.
The string includes only server/database and safe TLS/authentication metadata.
The Node app parses routing with `mssql.ConnectionPool.parseConnectionString`
and configures Entra authentication independently; it rejects embedded
credentials and unsafe TLS. Remove `SQL_SERVER`, `SQL_DATABASE` and `SQL_PORT`
before the deployment that adopts `SQL_CONNECTION_STRING`; do not configure both.

For ARM automation, read the current app and ETag, merge this connection into
`properties.versionConfiguration.connections`, preserve all other connections,
then sparse-PATCH using `If-Match`. On 412, refresh and reconcile, never force
overwrite. The list is a **complete replacement**, not an append. Do not copy
secret-free GET metadata over existing manual variable values. The supported
Builder CLI surface varies by release; inspect `builder app connections --help`
for typed Azure SQL options rather than assuming an upstream JSON-input flag.
See the [current connection contract](https://builder.appservice.azure.com/docs/reference/arm-api/#service-connection-configuration).

Named connections record routing and identity selection only. Neither ARM RBAC
nor a saved diagram node creates a contained SQL user, grants data permissions,
opens a firewall, tests SQL access or proves Serverless pause/resume behavior.
If the preview profile is unavailable, use routing variables; do not select
another database profile.

Builder CLI 0.0.1's typed Azure SQL command can fail reading the logical server
because it requests SQL API version `2022-11-01`. If that returns HTTP 400, use
the documented ARM connection write with the server resource ID; do not broaden
permissions or change the destination to work around it.

## Verify the deployed version

Save and deploy; saved desired configuration does not modify a serving version.
Use `/health/live` for platform probes and `/health` only for intentional SQL
connectivity checks. Verify seeded reads, default write denial, and (only when
approved) a bounded mutation followed by reading the same ID after restart.
Keep visitor access controlled before enabling writes. Anonymous 401 responses
from an app requiring sign-in do not establish that its SQL connection failed;
verify through an authenticated browser or an authorized runtime diagnostic,
without disabling authentication or exporting tokens.

The [verified deployment snapshot](../README.md#verified-deployment-snapshot)
records a successful named connection and fresh managed-identity SQL login.
The HTTP 400 typed-CLI issue above was encountered there; the connection was
saved using the conditional ARM write. The snapshot does not claim live CRUD,
process-restart persistence, auto-pause/resume or long-duration token-renewal
coverage. To run local integration tests, follow the
[separate disposable-database instructions](../README.md#checks), not the live
deployed app's connection.
