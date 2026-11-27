# Minvoice native acceptance

[Minvoice](https://github.com/ddyy/minvoice) is a third-party MIT-licensed invoicing application, not an integration template. `upstream.json` pins the application commit; `prepare.mjs` clones it, uses its own lockfile and asserts a clean checkout. No application code, middleware or configuration is rewritten.

The test runs its original Hono entry and SQL migrations in local workerd/D1. It seeds isolated business settings, disables payment/email integrations and uses a test-only password. No production Worker, database, customer, payment or email service is contacted.

The scenario signs in through the original form, creates a client and creates a draft invoice with two line items through the original add-line button. The invoice detail must render both descriptions, including Japanese text and literal form delimiters. Browser and native runs check ordered D1 line items, fractional quantity and totals in cents. Assertions check the saved database rows and reject a sandboxed cross-origin form submission. This is not acceptance of payment processors, email delivery, Cloudflare Access, PDF printing or every Minvoice feature.

```sh
npm install
npm run build
npm install --prefix demo
npm install --prefix demo/opennext
node demo/tests/upstream/minvoice/prepare.mjs
node --test demo/tests/upstream/minvoice/browser.test.mjs
UPSTREAM_PLATFORM=ios UPSTREAM_DEVICE=<simulator-udid> node --test demo/tests/upstream/minvoice/native.test.mjs
UPSTREAM_PLATFORM=android UPSTREAM_DEVICE=<emulator-id> node --test demo/tests/upstream/minvoice/native.test.mjs
```

The native tests share the `demo/opennext` platform shell; run tests using that shell serially. Generated files and reports are in `demo/artifacts/upstream/minvoice/`. The test-only HTML driver operates the original forms; it does not replace the application handlers or disable CSRF/authentication.
