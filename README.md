# ShopStream: Inventory & Fulfillment

A Data API builder (DAB) sample for **Azure SQL Database**. Use provisioned or serverless compute. App Service Builder serves the React UI at `/` and DAB at `/api`. Microsoft Entra sign-in and SQL row-level security scope inventory to each caller's warehouses. SQL handles receive, adjust, reserve and release commands transactionally, with durable receipts and movement history.

The [DAB app and setup guide](dab-poc/README.md) covers the protected ingress, managed identity for Azure SQL, database setup, API and deployment. Use the **repository root** as the Builder source directory.

| Path | Purpose |
| --- | --- |
| `builder.yaml` | Builder configuration for the UI and DAB API |
| `dab-poc/` | DAB configuration, .NET launcher, and React production UI |
| `db/inventory/` | Inventory schema migrations and administrator tooling |
| `infra/main.bicep` | Optional Azure SQL Database provisioning example using serverless compute |
| `test/` | Offline checks and opt-in SQL integration checks |

Use Node.js 24 and .NET 10. From the repository root:

```powershell
npm ci
npm test
npm ci --prefix dab-poc\ui
npm run build
builder manifest validate --json
```

Node.js is used for the frontend build and database administration, not as the API server. The original Express marketplace is preserved on [`nodejs-azure-sql-serverless`](https://github.com/saurabh500/app-service-builder-postgresql/tree/nodejs-azure-sql-serverless). This branch contains only the DAB app and its supporting files.

Based on the MIT-licensed [ShopStream sample](https://github.com/AzureAppService/app-service-builder-postgresql). See [LICENSE.md](LICENSE.md).
