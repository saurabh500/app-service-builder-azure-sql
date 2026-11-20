# ShopStream: Inventory & Fulfillment

A Data API builder (DAB) sample for **Azure SQL Database**. Use provisioned or serverless compute. App Service Builder serves the React UI at `/` and DAB at `/api`. Microsoft Entra sign-in and SQL row-level security scope inventory to each caller's warehouses. SQL handles receive, adjust, reserve and release commands transactionally, with durable receipts and movement history.

The [DAB app and setup guide](dab/README.md) covers the protected ingress, managed identity for Azure SQL, database setup, API and deployment. Use the **repository root** as the Builder source directory.

| Path | Purpose |
| --- | --- |
| `builder.yaml` | Builder configuration for the UI and DAB API |
| `dab/` | DAB configuration, .NET launcher, and React production UI |
| `db/inventory/` | Inventory schema migrations and administrator tooling |
| `infra/main.bicep` | Optional Azure SQL Database provisioning example using serverless compute |
| `test/` | Offline checks and opt-in SQL integration checks |

Use Node.js 24 and .NET 10. From the repository root:

```powershell
npm ci
npm test
npm ci --prefix dab\ui
npm run build
builder manifest validate --json
```

Node.js is used for the frontend build and database administration, not as the API server. The original Express marketplace is preserved on [`nodejs-azure-sql-serverless`](https://github.com/saurabh500/app-service-builder-postgresql/tree/nodejs-azure-sql-serverless). This branch contains only the DAB app and its supporting files.

## Set up with GitHub Copilot

Ask Copilot “Help me set up this ShopStream app on Azure” to use the repository's [`setup-shopstream` skill](.github/skills/setup-shopstream/SKILL.md). It guides database setup, managed identity, app settings, and deployment.

For general Azure SQL help, we recommend the optional [Microsoft SQL marketplace](https://github.com/microsoft/microsoft-sql). In Copilot CLI, opt in with:

```shell
copilot plugin marketplace add microsoft/microsoft-sql
copilot plugin install microsoft-sql@microsoft-sql
```

In VS Code, follow the marketplace's [VS Code instructions](https://github.com/microsoft/microsoft-sql#github-copilot-in-visual-studio-code) for `microsoft-sql-vscode`. The marketplace plugin is optional and separate from the MSSQL extension recommendation.

Based on the MIT-licensed [ShopStream sample](https://github.com/AzureAppService/app-service-builder-postgresql). See [LICENSE.md](LICENSE.md).
