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

Use Node.js 24. Before submitting changes, run `npm ci`, `npm test`, and
`npm run build`. Unit/route tests are database-free; the build does not install
or modify a database. CI also checks packaging and Bicep compilation, not a
live Azure deployment.

Follow [local setup](README.md#4-run-locally) for explicit `.env` loading,
limited developer identity and temporary exact-IP SQL access. Plain npm
scripts do not load `.env` themselves.

Database integration tests are a separate, write-enabled opt-in against an
explicitly confirmed dedicated seeded disposable database. Follow the
[integration command and cleanup warnings](README.md#checks); the test leaves
an order and stock change and must not target the deployed demo or production.
Do not treat passing offline tests as proof of live SQL execution, concurrent
stock behavior, token renewal or Serverless pause/resume.

Read [the code walkthrough](README.md#how-to-read-the-code) and
[schema ownership and upgrades](README.md#schema-ownership-and-upgrades) before
changing SQL. Bootstrap installs version 1 only: editing `db/schema.sql` does
not upgrade an existing database, and reset only replaces data. There is no
migration runner. The [DAB proof of concept](dab-poc/README.md) is a separate
application root; its read-only configuration test runs with `npm test`, while
the official DAB validator also connects to SQL. Keep runtime permissions
limited; schema upgrades require a separate explicit deployment process.

Never commit tokens, passwords, environment files, customer data, or
resource-specific credentials.
