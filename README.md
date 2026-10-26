# cf-workers-native

**Bring the app you built with Workers or Void to iOS and Android.**

Reach people who prefer the browser and people who look for apps in the store. Offer a mobile app alongside your web app, so your users can choose the platform that works for them.

## Your web app can have a mobile version

If you have a web app running on Cloudflare Workers, you can add an iOS and Android
app built around its existing pages and backend. For example, a Void app with
D1-backed forms can keep its loaders, actions and database on Workers while the
mobile app displays its pages and bundles its public JavaScript and CSS.

cf-workers-native connects your Workers application to a mobile app built with
Capacitor. Capacitor supplies the iOS and Android projects and access to native
plugins. You add a separate mobile build and test your application's flows; you
keep developing and deploying your web app to Cloudflare.

**Start here: [Add a mobile version to your existing app](docs/integration.md).**
You do not need an existing native app. The guide takes you from choosing your
Worker entry to running your pages on a simulator or emulator.

## See an example close to your app

| What you have                           | What to try                                      | What the example demonstrates                                                                |
| --------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| HTML pages served by a Worker           | [Hono / Express pages](demo/rendering/README.md) | Page navigation, forms and redirects inside a mobile app.                                    |
| A Void React Pages app using D1         | [Void + D1 sample](demo/void/README.md)          | Server-rendered pages, React interaction and a form that writes to D1.                       |
| A Next.js app deployed through OpenNext | [OpenNext sample](demo/opennext/README.md)       | Connecting generated pages and assets to a mobile build; see its version and feature limits. |

These are examples and test fixtures, not customer deployment stories. Each guide
states what has been verified. Start with the flow closest to yours, then try it
with your own app.

## What stays, what you add

- **Keep your pages and backend.** Reuse supported HTML, links, forms and client interactions. D1, server secrets and cloud-dependent logic stay on Workers.
- **Add a mobile build.** Connect your Worker and public assets to a Capacitor app with its own name and application ID.
- **Check the mobile experience.** Verify login, navigation, data changes, reopening and connection recovery in your application.
- **Prepare for distribution.** Configure signing and store information through the native application workflow. Store submission and review remain separate steps.

Start with requests running on your existing deployed Worker. Cloud-backed pages
need a connection. Bundled client assets do not make them offline applications.
Optional local execution is covered by the [execution guide](docs/cloudflare-bindings.md#choosing-execution)
and [compatibility limits](docs/compatibility.md).

## Start from your framework

| Workers application    | What you can bring                                                                   | Guide                                                |
| ---------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **Hono**               | Fetch handlers and HTML pages, including links and forms                             | [Hono setup](docs/build-setup.md#hono)               |
| **Workers Express**    | API handlers and HTML responses using the Workers entry                              | [Express setup](docs/build-setup.md#workers-express) |
| **Void React Pages**   | Worker-rendered pages, hydration and D1-backed forms                                 | [Void setup](docs/void.md)                           |
| **Next.js / OpenNext** | Pages backed by the deployed Worker, with local route selection for supported builds | [OpenNext setup](docs/opennext.md)                   |

Each guide describes its tested versions and boundaries. Already have a separate frontend calling Worker APIs? Keep that frontend and use the [Fetch-only integration](docs/runtime.md#fetch-only-integration).

## Try it with your app

You need the application's source, its Worker build and a test Worker URL for
cloud-backed flows. Running iOS requires macOS and Xcode; Android requires the
Android development tools. The [setup guide](docs/integration.md#before-you-start)
links the platform prerequisites.

Install the package in your web project, then follow the
[complete mobile setup](docs/integration.md#workflow):

```sh
npm install --save-exact cf-workers-native@0.1.7
```

Installation alone does not generate a mobile project. The guide covers adding
Capacitor, configuring the mobile build, and running it on iOS or Android. Your
first milestone is one existing page, a link to another page, and a working form
or data action on a simulator or emulator.

**All 0.x releases are Preview releases**, including those on npm's `latest` tag.
APIs may change. Use your app's actual flows to evaluate the fit before distribution.
Upgrading from `workers-capacitor`? Follow the [migration steps](docs/integration.md#migrating-from-the-old-npm-package).

## Build with your AI assistant

Open your application repository and give your assistant this prompt:

```text
Read https://github.com/rdlabo-dev/cf-workers-native/blob/main/docs/integration.md.
Add an iOS and Android version of this Workers web app using cf-workers-native@0.1.7
and Capacitor. Preserve the existing pages, backend and Cloudflare deployment configuration.
Use an existing test Worker for cloud-backed requests; ask before any cloud deployment.
Start by verifying one page, navigation and a form or data action on a simulator/emulator.
Then verify the app's authentication and main user flow, and report remaining limits.
```

Provide your app name, application ID and test Worker URL if you have them.

## Already have a native app?

Embed a Workers-powered screen in your existing [UIKit / SwiftUI app](docs/native-embedding.md#ios)
or [Android app](docs/native-embedding.md#android). These integrations use the
native SDKs and a shared web build. Follow the [dependency setup](docs/native-embedding.md#dependency-setup)
for the matching npm, SwiftPM and Maven versions and Android WebView requirements.

## Make it ready for your users

Follow a real flow from launch to sign-out: load a page, navigate, submit a form, reopen the app and check what happens when the network is unavailable. Keep secrets on the Worker and enforce authentication and authorization there. The [integration checklist](docs/integration.md#6-verify-the-existing-application-in-capacitor) and [native embedding checks](docs/native-embedding.md#verification) explain what to verify.

For an existing native app, use its release workflow. For Capacitor, continue with [safe areas and native plugins](docs/native-rendering-api.md). Store submission and review remain part of your application's release process.

## Explore and contribute

[Documentation](docs/README.md) · [Examples](demo/README.md) · [Compatibility](docs/compatibility.md) · [Development](docs/development.md) · [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE).
