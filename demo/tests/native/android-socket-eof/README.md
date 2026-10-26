# Android TLS EOF dispatch regression

Run after building an Android acceptance consumer (Java and the pinned Netty jars
in the Gradle cache are required):

```sh
python3 demo/tests/native/android-socket-eof/run.py
```

The runner compiles the current `WorkerSockets.java`, not a copy of its logic.
Reflection initializes its actual private Connection; Netty's EmbeddedChannel
supplies the pipeline context and executor. Only Android Base64 and Capacitor's
JSON result container are replaced with JVM equivalents. An optional source path
allows a previous revision to be checked with the same regression.

A successful TLS close notification is delivered before an 8,192-byte plaintext
callback in the same pipeline dispatch. The pending read must receive those bytes,
then one watch completion, then EOF on the next read. Inactive, input shutdown,
reset-after-close-notify and duplicate-close paths must preserve that ordering.
This protects against reentrant pipeline dispatch; it does not replace the native
TLS authentication, truncation, lifecycle or iOS/Android integration contracts.
