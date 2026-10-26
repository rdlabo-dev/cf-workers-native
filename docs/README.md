# Add a mobile version to your Cloudflare Workers app

Keep your web application on Cloudflare and bring its pages and flows to iOS and
Android. Start by running a small part of your existing app on a simulator or
emulator, then verify the rest of the experience before distribution.

## Start with something you recognize

| Your starting point                   | See it in an example                                | Connect your own app                                        |
| ------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Worker-rendered HTML and forms        | [Hono / Express pages](../demo/rendering/README.md) | [Worker build setup](build-setup.md#frameworks)             |
| Void React Pages with D1              | [Void sample](../demo/void/README.md)               | [Void integration](void.md)                                 |
| Next.js on Workers through OpenNext   | [OpenNext sample](../demo/opennext/README.md)       | [OpenNext integration](opennext.md)                         |
| A separate frontend using Worker APIs | [Fetch-only demo](../demo/README.md)                | [Fetch-only integration](runtime.md#fetch-only-integration) |

Samples show specific integrations and their verification boundaries. They do not
establish that every application using the same framework will work unchanged.

## Make your first mobile build

Follow [Add a mobile version with Capacitor](integration.md). Capacitor creates the
iOS and Android projects; cf-workers-native connects them to your Workers app.
You do not need an existing native application.

1. Identify your Worker build, public assets and test Worker URL.
2. Add the mobile project and its separate build configuration.
3. Run one existing page, follow a link, and submit a form or perform a data action.
4. Verify login, data changes, reopening and network recovery in your own app.
5. Prepare signing and distribution using the native app's release workflow.

The guide includes [prerequisites](integration.md#before-you-start) and a
[prompt for your AI assistant](integration.md#prompt-to-give-your-ai-assistant).
Start with the existing Worker handling requests remotely; local execution is an
optional later step. Setup currently requires configuration, not a single project-generation command.

## Add a screen to an existing native app

If you already maintain an iOS or Android app, use [native embedding](native-embedding.md)
instead. Follow the [UIKit / SwiftUI](native-embedding.md#ios) or
[Android](native-embedding.md#android) guide and the
[published dependency matrix](native-embedding.md#dependency-setup). Android uses
the Maven SDK and requires WebView `MULTI_PROFILE` support.

## Understand where your code runs

Start with network execution: requests go to your existing deployed Worker. Bundle public client assets with the app, then select local routes only where your application benefits and the build supports them.

| Question                                                            | Read                                                                                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Which requests stay on Workers, and which can run locally?          | [Execution policies and Cloudflare bindings](cloudflare-bindings.md)                                           |
| How do Worker responses become native WebView pages?                | [Document rendering and native APIs](native-rendering-api.md)                                                  |
| How do I configure initialization, Fetch interception and disposal? | [Runtime reference](runtime.md)                                                                                |
| How do D1-backed requests retain their server boundary?             | [D1 and remote execution](d1-transparent-migration.md)                                                         |
| How do I use other bindings?                                        | [KV](kv.md), [Hyperdrive](hyperdrive-transparent-migration.md), [Service bindings](remote-service-bindings.md) |

## Verify before distribution

Follow the [native embedding verification](native-embedding.md#verification) or [Capacitor acceptance flow](integration.md#6-verify-the-existing-application-in-capacitor). Test navigation, authentication, mutations, lifecycle and network failures in your own app. Simulator/emulator results do not replace checking the devices you intend to support.

Review [security responsibilities](integration.md#5-security-the-device-is-not-a-trusted-server) and [known limitations](compatibility.md). This release is **0.1.5**; native embedding does not supply general Capacitor plugin integration or automatic store publication.

## Examples and development

[Choose an example](../demo/README.md) to see the relevant integration. To work on the SDK itself, start with [development and tests](development.md) and [contributing](../CONTRIBUTING.md). [Contracts](contracts.md) describes the runtime interfaces; [test execution](test-execution-time.md) explains the CI test groups.
