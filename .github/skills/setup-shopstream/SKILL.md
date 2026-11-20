---
name: setup-shopstream
description: Guide setup or deployment of the ShopStream Data API builder sample with App Service Builder and Azure SQL Database. Use for fresh database setup, inventory migrations, managed identity grants, app settings, or deployment verification.
---

# Set up ShopStream

Read [the DAB setup guide](../../../dab/README.md) before giving commands. Use it as the source for exact settings and scripts; its historical deployment details are not defaults. Start with a checklist unless the user asks you to execute it. Before making changes, confirm the Azure subscription, resource group, Builder app, SQL server and database, and get explicit approval for provisioning, SQL changes, grants, or deployment. Do not request or print credentials or commit environment files.

1. **Prepare the database.** Use Azure SQL Database with provisioned or serverless compute. Follow the database prerequisites in the guide. Skip catalog bootstrap if the ShopStream catalog is already populated; otherwise use the pinned bootstrap instructions only on a new, empty DEV/TEST database. Do not reset or reseed a shared database.
2. **Install inventory as an Entra SQL administrator.** Set the target database confirmation and the initial manager's tenant ID and Entra user object ID, then run `node db/inventory/setup.js migrate` from the repository root after `npm ci`. Do not edit applied migrations or run setup from the app's build or startup.
3. **Configure Builder and SQL access.** Set the source directory to the repository root. Enable the app's system-assigned managed identity and require Microsoft Entra sign-in at Builder's ingress. Configure `ASPNETCORE_URLS`, `SQL_CONNECTION_STRING`, and `WEBSITE_AUTH_ENABLED` as shown in the guide; the last setting does not enable sign-in by itself. In the target database, create the contained user using the app identity's **client ID**, not its object ID. Follow the guide for catalog `SELECT` and `grant-read`; do not grant database roles or direct table writes.
4. **Verify reads before enabling writes.** For a fresh app, deploy a read-only configuration without `InventoryCommand`. Check that anonymous access is blocked and that a signed-in caller sees only their assigned warehouses and the expected catalog. Then, with approval, run `grant-write` and restore the command entity for deployment. Keep the request-header check, RLS, and protected ingress in place. Do not execute live inventory commands just to verify deployment without approval for a disposable test target.

Report the steps actually performed, any approvals or prerequisites still needed, and which live checks were not run. Do not treat a successful build or an HTTP reachability probe as proof of SQL access.
