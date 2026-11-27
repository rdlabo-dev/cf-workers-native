# Native document rendering through workersCapacitor

The package includes the native connection for Capacitor 8 (verified with 8.5.3).
iOS uses Swift Package Manager; Android uses Gradle. CocoaPods is not included in
this Preview.

For an existing native application without Capacitor setup, see
[native application embedding](native-embedding.md).

## Installation

Install the package in your Capacitor application using the [Preview installation steps](integration.md#2-install-capacitor-and-this-package).

Configure the Worker in the Vite/esbuild plugin and call
`workersCapacitor({ baseURL, render: "/" })`. Build the web assets before
synchronizing:

```sh
npm run build
npx cap sync
npx cap run ios # or android
```

The Capacitor CLI discovers and registers the native plugin. The application
keeps its ordinary Activity/ViewController; no manual registration or copied
native sources are needed. The browser Fetch-only API remains available without
installing Capacitor.

## Application entry

```ts
import { workersCapacitor } from "cf-workers-native/capacitor";

const app = workersCapacitor({
  baseURL: "https://worker.invalid",
  render: "/",
});
await app.ready;
```

`render` is the initial local document path. Omit it to retain the existing
Fetch-only behavior. Document mode requires an HTTP(S) **origin** as `baseURL`,
without an API path prefix. The Worker receives URLs under that logical origin;
the visible page retains its Capacitor local URL (`capacitor://` on default iOS,
`https://` on default Android). The generated dispatch can select local execution
or the configured remote Worker before invoking a handler; both paths return a
document through the same native bridge. Local failures are not retried remotely,
and no local HTTP server is started. See [remote execution setup](integration.md#3-configure-and-build-the-native-application).

Hono and Workers Express use the same `worker.fetch(request, env, ctx)` boundary.
Their application routers return complete HTML for pages and JSON for APIs. The
adapter does not add an application router. Existing `worker`, `env`, `prefer`,
`drain()` and background-error handling continue to apply to the runtime host.

`ready` means that the Worker and native connection are initialized. It does not
mean all images or page scripts have finished loading. `await app.dispose()`
releases the document connection and runtime. Fetch-only disposal may also be asynchronous while network resources, a lazy module, or a previous Android document registration are being released. Always use `await app.dispose()` when cleanup must finish before reinitialization. Document startup errors restore the original fetch
implementation; Fetch-only Worker startup errors continue to reject local requests
until explicit disposal.

## iOS Safe Area

Worker document WebViews default to `automatic` content insets when
`ios.contentInset` is omitted. An explicit value in `capacitor.config.ts` or
`capacitor.config.json` takes precedence, using Capacitor's existing options:
`automatic`, `scrollableAxes`, `never`, or `always`.

For an application that handles Safe Area in CSS and needs edge-to-edge content:

```ts
const config: CapacitorConfig = {
  // Other Capacitor settings...
  ios: { contentInset: "never" },
};
```

Run `npx cap sync ios` after changing this setting. This default applies to the
native Worker document view; the ordinary Fetch-only WebView retains Capacitor's
normal behavior. No new `workersCapacitor` option is required.

## Native plugins

Choose a feature that helps your users, such as taking a photo, opening the share sheet or feeling feedback after an action. Browse the [official Capacitor plugins](https://capacitorjs.com/docs/apis) and follow the selected plugin's installation and permission setup.

1. Install a plugin version compatible with Capacitor 8 in your application, configure its required iOS/Android permissions, rebuild the web assets and run `npx cap sync`.
2. Call the plugin from the page's client-side JavaScript in response to a user action. Keep these calls out of SSR and Worker handlers: the native feature belongs to the device. For a remotely rendered page, include the plugin's JavaScript in that page's client build and its native package in the Capacitor application.
3. Check the feature on each target platform, including permission denial, navigation away and back, and app resume. Register page listeners when the page mounts and remove them when it unmounts; a new document needs new listeners. If the same page runs on the web, provide the plugin's supported web behavior or an alternative UI.

See [Using Plugins](https://capacitorjs.com/docs/basics/using-plugins) for the Capacitor workflow and [plugin lifecycle boundaries](integration.md#treat-packaged-code-and-data-as-extractable) for this library's document host.

## Build configuration

The existing Vite or esbuild plugin automatically prepares document assets:

```ts
workersCapacitorPlugin({
  worker: "./workers/hono.tsx", // Or the Workers Express entry.
});
```

Only `render` selects document rendering at runtime; it is unrelated to whether
the application uses `form[action]`. Builds include the small internal assets
even for Fetch-only applications, but do not register a Service Worker or start
native document rendering unless `render` is set.

For native rendering, use Vite with `base: '/'` and build before Capacitor
copy/sync. The Vite dev server remains available for Fetch-only development;
native document rendering requires bundled assets. esbuild writes the assets
next to its `outfile` or into `outdir` (in-memory `write: false` builds do not
prepare native document assets). Place any separately copied static files in
the output directory before building so they appear in the asset manifest.

The generated `workers-capacitor-assets.json` identifies bundled assets, which
bypass the Worker router. All other local paths reach the Worker. Android uses
`workers-capacitor-sw.js` for browser-native Request/Response and redirect
handling. These filenames are implementation assets, not application imports.
A raw-ESM setup must supply the equivalent SW file and asset manifest itself;
the automated asset integration currently covers Vite and esbuild.

## Native implementation

- iOS keeps the ordinary application controller. The plugin retains its existing
  WebView as the runtime host and adds an internal document controller. Its scheme
  handler is registered before the document WebView is created. The host invokes
  the same Fetch Handler through the library's existing Worker transport.
- Android keeps the ordinary Activity and visible WebView. The plugin creates a
  persistent host, using the bundled bootstrap's internal host mode. A Service
  Worker forwards requests to that host and serves responses through normal
  browser navigation. The bootstrap executes again in the host, so application
  startup side effects should not be placed after or alongside runtime startup.
- The package's native sources live under `native/`. `Package.swift` and the
  Android library project are included in the npm tarball. Measurement/report
  hooks live under `demo/tests/`; they are not in the native implementation.

No application Activity/ViewController replacement, iframe, Turbo, or HTML DOM
replacement is required. The two-WebView lifecycle is internal to the adapter.

## Scope and limits

This is a Preview release. Document rendering is native-only; ordinary browser/Electron/
Tauri document startup is not implemented. Existing browser Fetch-only behavior
is unchanged. Response bodies are pulled in bounded chunks; document uploads
remain buffered with an 8 MiB limit. HTTP caching is disabled for
Worker responses. External redirects are rejected. On iOS, the page-side Fetch
bridge models redirect metadata with JavaScript properties rather than browser
internal Response slots. The iOS multipart form supplement covers same-window
local POST submissions; named windows and iframe targets are not supported.
Observed Origin and Fetch Metadata headers are preserved. When iOS omits a form Origin, the bridge recovers it only from a verified local main-frame WebKit security origin. Opaque or unknown initiators remain untrusted. For state-changing document fetches missing Origin, iOS also checks the sending main frame. Android recovers the local origin for explicit same-origin fetches from a same-origin top-level window client. Other native requests can still omit Origin; retain CSRF protection, such as a validated token. Origin is not authentication.

The native host/child lifecycle, pending-request timeouts and explicit disposal
are implemented. App process termination/relaunch, background/foreground,
asset-update reinstalls without data deletion, and shutdown followed by
reinitialization are covered by the packaged native fixture, including selected
physical-device scenarios. Validate your application on its target devices;
WebView crash recovery, memory pressure and arbitrary third-party plugin lifecycle
behavior remain outside this coverage.

## Demo and validation

[demo/rendering](../demo/rendering) contains readable Hono/TSX and Workers Express
examples: root HTML, links, POST followed by a 303 redirect, and a JSON endpoint.
The normal Fetch-only demo remains separate.

`tests/unit/documents.test.ts` exercises the public entry, startup errors,
restoration, disposal and routing. Service Worker tests cover POST bytes,
redirect mapping and asset manifest changes after an update. Both Vite and
esbuild build the public entry in `demo/tests/build/documents.test.ts`.

The packaged native acceptance fixture at `demo/tests/fixtures/apps/packaged-native`
calls the same public API. A test-only Worker wrapper adds the browser test driver
to returned HTML. It is installed from a real tarball into an independent consumer,
then uses ordinary `cap add`/`cap sync`. No native code or registration is patched.
See `demo/tests/README.md` for reproduction commands.

### Shutdown and trust boundary

Android shutdown and failed startup disable and unregister only this library's
Service Worker. Fetch-only startup also clears an earlier document registration;
await `ready` before using the application. Already controlled pages switch to
native request handling without waiting for navigation. The disabled state is
persisted across Service Worker idle termination. Older transports without the
shutdown protocol require a reload after unregistration. Android Fetch-only
`dispose()` can return a promise while this migration is pending.

An existing application Service Worker at the root scope is not overwritten.
Document rendering reports a conflict instead. Other application registrations
are not removed during cleanup.

The bundled Worker and the HTML it produces are trusted application code. Pages
run at the Capacitor local origin and can access the application's native plugins,
just like bundled HTML. Rendering is not a sandbox for untrusted HTML; applications
must escape untrusted values and must not render arbitrary remote HTML as trusted
application pages. This trust model applies to both iOS and Android.

### Absolute article links

Ordinary main-frame links to the configured `baseURL` origin navigate to the corresponding local document path, preserving query and fragment. Match `baseURL` to the application's Worker origin when it generates absolute links. Relative links keep their normal behavior.

The handler respects framework-handled clicks, modifier keys, downloads and non-self targets. It does not rewrite external origins, iframe links, absolute form actions or arbitrary programmatic navigation. Android requires WebView document-start script support for this behavior; iOS uses the existing document-start script.
