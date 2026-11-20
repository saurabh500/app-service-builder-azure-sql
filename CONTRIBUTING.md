# Contributing

This project welcomes contributions and suggestions. Most contributions require
you to agree to a Contributor License Agreement (CLA) declaring that you have
the right to grant the rights to use your contribution. See
https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will determine whether you need to
provide a CLA and decorate the pull request appropriately. Follow the bot's
instructions. You only need to do this once across Microsoft repositories.

This project follows the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
See the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/)
or contact opencode@microsoft.com with additional questions or comments.

## Local checks and database changes

Use Node.js 24 and .NET 10. Run the [local checks](dab/README.md#local-checks)
before submitting changes. CI checks the UI build, DAB packaging, host behavior
and database Bicep compilation. The official DAB validator and opt-in
integration tests connect to SQL. Run write-enabled tests only against a
confirmed disposable database, never the deployed demo or production.

Read the [inventory setup guide](dab/README.md#inventory-schema-rls-and-administrator-setup)
before changing SQL. Do not modify an applied migration; add a new numbered one.
Keep runtime permissions limited to the documented catalog, views and procedure.

Never commit tokens, passwords, environment files, customer data, or
resource-specific credentials.
