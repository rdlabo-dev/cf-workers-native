import { createNetworkFixture } from "../fixtures/network/server.mjs";
import { createTlsFixtures } from "../fixtures/network/tls.mjs";
const tls = createTlsFixtures();
const server = createNetworkFixture();
if (process.env.CI)
  server.on("request", (request) =>
    console.log(
      request.method,
      new URL(request.url, "http://fixture.invalid").pathname,
    ),
  );
server.listen(4201, "0.0.0.0", () =>
  console.log("Native network fixture listening on port 4201"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const instance of tls) {
      instance.closeAllConnections();
      instance.close();
    }
    server.closeAllConnections();
    server.close();
  });
