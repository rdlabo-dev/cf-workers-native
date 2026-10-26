# Embed Workers UI in an existing native application

Add your Workers pages to a screen in an existing UIKit, SwiftUI or Android app.
Keep the native app's entry point, navigation and root screen while reusing your
Workers routes and rendering inside the SDK's WebView.

Choose [iOS](#ios) or [Android](#android) for native setup. Both use the
[shared web build](#shared-web-build) below and the same runtime options. For a
new mobile app or general native plugins, use the [Capacitor integration](integration.md).

You will build the web assets in your web project, add the native SDK to your
app, then open and close a Workers screen through its native API. The SDK resolves
Capacitor internally; your native app does not need Capacitor configuration or CLI commands.

**0.1.5:** install `cf-workers-native@0.1.5` with matching
[native dependencies](#dependency-setup). Android requires WebView `MULTI_PROFILE`
support. The previously published Maven `0.1.2` SDK does not include the
0.1.5 TLS upgrade bridge; see the Android version boundary below.

## Shared web build

The Workers application uses the same Worker source, options, and
[Vite/esbuild build configuration](build-setup.md) as cf-workers-native. Select
the entry for the target platform:

```ts
import { workersIOS } from "cf-workers-native/ios";

const app = workersIOS({
  baseURL: "https://worker.invalid",
  render: "/",
});
await app.ready;
```

For Android, import `workersAndroid` from `cf-workers-native/android` with the
same options. Both entries return `ready`, `execution`, `drain()` and `dispose()`.
They also connect native screen closure to disposal in the Worker runtime.
Keep the generated asset directory intact, including the manifests and runtime
chunks. Build web assets in the web project or CI; the native project does not
need npm, `node_modules`, Capacitor CLI commands, or `capacitor.config.*`.

Build a small web entry for each target. For example, use the `workersIOS`
initialization above in `src/main.ts` and this root `index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Use a separate mobile Vite configuration:

```ts
// vite.mobile.config.ts
import { defineConfig } from "vite";
import { workersCapacitorPlugin } from "cf-workers-native/tooling/vite";

export default defineConfig({
  plugins: [workersCapacitorPlugin({ worker: "./src/worker.ts" })],
  build: { outDir: "dist-mobile" },
});
```

Run `npx vite build --config vite.mobile.config.ts` in the web project. The plugin
name remains `workersCapacitorPlugin` for all three hosts. The default execution
policy keeps the Worker remote; replace `https://worker.invalid` with your deployed
Worker origin. Follow the [framework guide](build-setup.md#frameworks) for generated
Worker entries and public assets. Use `workersAndroid` in the Android build's
entry; keep each target's output separate.

Package the **entire** output directory, including `index.html`, into the native
app. Do not point this build at the cloud deployment output or add this plugin to
the Cloudflare build. Local route permissions and remote authentication options
are the same as for [Capacitor](integration.md).
The SDK starts the bundled entry; `render: "/"` selects the initial Worker page.
`ready` reports runtime initialization, not completion of page scripts or images.

## Dependency setup

There is one npm package, `cf-workers-native`. Its `/ios`, `/android` and `/capacitor`
entries are subpath imports, not separate npm packages. There is no bare package-root runtime entry. `WorkersIOS` is a SwiftPM product;
`io.github.rdlabo:cf-workers-native-android` is an Android Maven artifact.

Install the npm Preview in the web project. The `latest` tag includes 0.x Preview releases:

```sh
npm install --save-exact cf-workers-native@0.1.5
```

Use the dependency set below. npm 0.1.5 and SwiftPM `v0.1.5` share the release
commit. For Capacitor, npm includes the matching Android native implementation.
The separately published Maven 0.1.2 artifact predates the 0.1.5 TLS upgrade
bridge; do not treat it as the matching native SDK for all 0.1.5 features:

| Component  | Dependency                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| JavaScript | `cf-workers-native@0.1.5`                                                                                     |
| iOS        | SwiftPM tag `v0.1.5`, product `WorkersIOS`                                                                    |
| Android    | Matching `v0.1.5` native sources via local publication; Maven Central `0.1.2` predates the TLS upgrade bridge |

For local SDK development, create a JavaScript package tarball from the matching checkout:

```sh
# In the SDK checkout:
npm install
npm pack

# In the web project:
npm install /path/to/cf-workers-native/cf-workers-native-0.1.5.tgz
```

`npm pack` runs the build through `prepack`; the filename above uses the current
source version. Install the tarball rather than the checkout directory to avoid
a symlink back into the SDK tree, which can create recursive paths for apps inside
that checkout. Use the same Git revision for the iOS Swift package and Android publication. Installing the published
`workers-capacitor@0.1.1` does not provide these entry points.

When migrating from the old npm package, remove the `workers-capacitor` dependency before installing `cf-workers-native`; see the [migration steps](integration.md#migrating-from-the-old-npm-package). Keep only the renamed package in the web project.

The native project consumes generated assets and native dependencies only.
The source checkout's npm and build tools belong in the web build or CI.

## iOS

Add `https://github.com/rdlabo-dev/cf-workers-native` as a Swift package pinned to
tag `v0.1.5` for npm 0.1.5 (or the matching revision for a source build), and select the `WorkersIOS` product. The existing `v0.1.2` tag predates the package rename; use `v0.1.5` for this release. Use Xcode 26 /
Swift 6.2 or newer, as required by the native dependency toolchain.
Add your generated assets as a folder resource, for example `WorkerWeb`, then
create the controller from that directory on the main actor:

```swift
import WorkersIOS

let assets = Bundle.main.resourceURL!.appendingPathComponent("WorkerWeb")
let workers = try WorkersViewController(assets: assets)
workers.onStartupError = { message in
    // Show an error in your existing native screen.
    print(message)
}
```

Use normal UIKit child-controller containment or present the controller from
your existing screen. Before removing or dismissing it, await closure:

```swift
try await workers.close()
```

Closure releases resources even when JavaScript disposal fails; report that
error as appropriate in your application. A closed controller is terminal.
Create a new controller when opening the Workers screen again.

For SwiftUI, retain the controller for the view's lifetime and embed
`WorkersView(controller: workers)`. The representable closes its controller
when dismantled. The SDK supplies its own Capacitor configuration and registers
the Workers plugin; your application does not register plugins or replace its
application delegate.

Failed Worker startup releases the embedded runtime and reports `startupError`
and `onStartupError`. The SDK does not pop or replace your native navigation.
When the controller first appears, startup must complete within 30 seconds.
This also detects missing or broken entry scripts that cannot report an error
from JavaScript. Explicit closure cancels the pending startup notification.

## Android

Add the SDK's Android Maven publication to your app's dependencies and include
the generated web directory under `src/main/assets/`, for example `worker-web`.
The publication resolves Capacitor and its other native dependencies.
The previously published Maven coordinate is `io.github.rdlabo:cf-workers-native-android:0.1.2`.
This is the previously published SDK, not the matching Android native code for
npm 0.1.5. In particular, it does not include the new same-connection TLS upgrade
bridge. For the current implementation, use the Android native sources from the
matching release with the local publication workflow in [development](development.md#android-maven-publication),
or use Capacitor, which installs those sources from npm.
Use Java 21 and Android SDK 36, with `ANDROID_HOME` pointing to the installed SDK.
Include `google()` and `mavenCentral()` in your app's dependency repositories.
For an application deliberately retaining that older SDK, the Groovy dependency is:

```groovy
dependencies {
    implementation 'io.github.rdlabo:cf-workers-native-android:0.1.2'
}
android {
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_21
        targetCompatibility JavaVersion.VERSION_21
    }
    packaging.resources {
        excludes += 'META-INF/INDEX.LIST'
        merges += 'META-INF/io.netty.versions.properties'
    }
}
```

The resource rules combine the native networking dependencies' metadata.
For local SDK development or release verification, see the
[independent Android consumer](../demo/tests/native-embedding/android/README.md).
Keep the generated directory at `src/main/assets/worker-web/`, with its
`index.html` directly inside it.

Open the SDK-owned screen from your existing Activity:

```java
import jp.rdlabo.workerscapacitor.WorkersNative;

if (WorkersNative.isSupported()) {
    WorkersNative.open(this, "worker-web");
} else {
    // Show an unsupported-WebView message in your existing native UI.
}
```

The existing Activity can remain a ComponentActivity. The SDK owns its
AppCompatActivity and WebView; the application does not change its superclass,
initialize a Capacitor bridge, or register the Workers plugin.

The installed Android WebView must support AndroidX WebKit `MULTI_PROFILE`.
Check `WorkersNative.isSupported()` before offering the screen on devices where
WebView availability is uncertain. `open()` throws `UnsupportedOperationException`
when this feature is unavailable; updating the device's WebView may enable it.

The SDK uses a dedicated persistent WebView profile for its cookies, storage,
and Service Worker routing. Existing host session cookies, the Java
`CookieHandler`, and the host's Service Worker client remain unchanged. SDK
cookies are separate from host cookies and persist across SDK screen openings.
Capacitor's application-wide core plugins are not registered in this host.

Only one SDK screen can be active at a time. Activity recreation waits for the
previous runtime to release ownership before starting its replacement.
Startup must complete within 30 seconds; failed or incomplete startup closes
the SDK screen and returns to the existing Activity.

## Compatibility

Use the compatible JS/native dependency set above. For source builds, use matching
revisions. The new hosts share the existing
cf-workers-native runtime and build tooling; they do not change Cloudflare
deployment inputs or add a remote Worker deployment.

For general native plugins, use the existing
[Capacitor integration](native-rendering-api.md). These embedding hosts provide
the Workers UI and its runtime connection.

## Verification

Verify an actual user flow in your host app: opening, navigation, form submission,
authentication, closing and reopening. On iOS, exercise UIKit removal or SwiftUI
dismantling; on Android, include rotation and Activity recreation. Confirm that
existing host sessions and WebView flows still work. Android SDK cookies live in
a separate profile, so do not assume a host WebView login transfers to the SDK.
Keep the Worker's existing authentication and authorization; see the shared
[security guidance](integration.md#5-security-the-device-is-not-a-trusted-server).

The independent [iOS consumer](../demo/tests/native-embedding/ios/README.md) and
[Android consumer](../demo/tests/native-embedding/android/README.md) provide
repeatable SDK acceptance checks, including startup failure, missing entry
scripts and healthy operation beyond the startup deadline. These checks cover
simulators/emulators, not physical-device behavior or measured WebView deallocation.
General framework acceptance from the Capacitor demos is not a claim that every
framework flow has also been exercised inside these embedding hosts.
