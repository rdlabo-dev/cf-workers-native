# Pinned Node compatibility experiments

`exports.json` pins the workerd package and compatibility date. The public
expansion probe runs shared operation contracts through both build plugins,
Chromium/WebKit, page and Dedicated Worker. Surface inventory results are separate
from behavioral acceptance.

From the repository root:

```sh
node --test demo/tests/experiments/node-compat/expansion-contracts.probe.mjs
node demo/tests/experiments/node-compat/prepare-events-consumer.mjs
CONSUMER_PACKAGE=/absolute/path/to/prepared.tgz npm run test:package
node demo/tests/experiments/node-compat/expansion-native.mjs ios <simulator-udid>
node demo/tests/experiments/node-compat/expansion-native.mjs android <emulator-id>
```

Run the native commands sequentially: they share the independent installed
consumer. Set the Android SDK and `adb` PATH as described in the native test
procedure. Preparation writes the exact tarball path and SHA-256 to
`demo/artifacts/node-inventory/events-consumer.json`; the native runner checks that
hash before compiling the consumer. Do not rebuild repository `dist` while a
public browser probe reads it.

Native networking needs OpenSSL and Python3. Local HTTP/HTTPS, TLS, STARTTLS and
WebSocket peers use ephemeral loopback ports. The Python TLS peer explicitly calls
`unwrap()` to send close_notify; separate peers end or reset the TCP connection
without that TLS notification. The generated test CA is confined to the debug
consumer/simulator trust configuration. Workerd uses the same CA and fixture
ports. FS lifetime probes use two real workerd requests and distinct native
request scopes.

Page cases run in independent iframe realms and remove each frame on completion.
Dedicated Workers terminate after each case. This permits cold Wasm measurements
without retaining a module instance for every case in one page. Progress and
failure records identify the active case. The overall native deadline is separate
from individual case and socket deadlines.

`NODE_COMPAT_CASES=name,otherName` filters shared cases for diagnosis. It does not
filter native network rows, and a filtered run is not full acceptance. Native
`stage:complete` means all observations were collected; exact assertions run
subsequently and may still fail. Current TLS and WebSocket implementation gaps
remain failures, not skipped or accepted differences. The reports, generated
harness, compiled hash and workerd baseline live under
`demo/artifacts/node-inventory/native-expansion/<platform>/`.

The narrowly approved attachment size-accounting boundary is documented in the
[WebSocket candidate notes](../../../../src/browser/websocket/README.md). Run
`node --test demo/tests/experiments/node-compat/websocket-attachment-boundary.probe.mjs`
to reproduce its pinned Workers observations. This reference probe does not
certify the candidate or exempt network failures from acceptance.
