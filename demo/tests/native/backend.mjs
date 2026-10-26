import { createServer } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Local HTTPS transport for native acceptance; no authentication or application
// response is mocked. The only HTML addition is the scenario's UI test driver.
export async function nativeBackend({
  dispatch,
  driver,
  dispose,
  instrument = () => true,
  tlsDirectory,
  onReport = () => {},
}) {
  const directory =
    tlsDirectory ?? (await mkdtemp(join(tmpdir(), "native-acceptance-")));
  if (!tlsDirectory)
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        "key.pem",
        "-out",
        "ca.pem",
        "-days",
        "2",
        "-subj",
        "/CN=Native acceptance",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
      ],
      { cwd: directory, stdio: "pipe" },
    );
  const reports = [],
    requests = [];
  const server = createServer(
    {
      key: await readFile(join(directory, "key.pem")),
      cert: await readFile(join(directory, "ca.pem")),
    },
    async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        if (req.url === "/__acceptance/report") {
          const report = JSON.parse(Buffer.concat(chunks).toString());
          reports.push(report);
          onReport(report);
          res.end("ok");
          return;
        }
        if (req.url === "/__acceptance/driver.js") {
          res.setHeader("content-type", "text/javascript");
          res.end(driver);
          return;
        }
        const started = performance.now();
        const record = {
          method: req.method,
          path: req.url,
          origin: req.headers.origin,
          site: req.headers["sec-fetch-site"],
        };
        requests.push(record);
        const headers = { ...req.headers };
        delete headers["content-length"];
        delete headers["transfer-encoding"];
        const response = await dispatch(
          `https://${req.headers.host}${req.url}`,
          {
            method: req.method,
            headers,
            body: ["GET", "HEAD"].includes(req.method)
              ? undefined
              : Buffer.concat(chunks),
            redirect: "manual",
          },
        );
        record.status = response.status;
        const out = Object.fromEntries(response.headers);
        delete out["content-length"];
        delete out["content-encoding"];
        delete out["transfer-encoding"];
        if (response.headers.getSetCookie().length)
          out["set-cookie"] = response.headers.getSetCookie();
        let body = Buffer.from(await response.arrayBuffer());
        if (instrument(req.url) && out["content-type"]?.includes("text/html"))
          body = Buffer.from(
            body
              .toString()
              .replace(
                "</body>",
                '<script src="/__acceptance/driver.js"></script></body>',
              ),
          );
        res.writeHead(response.status, out);
        record.elapsedMs = Math.round(performance.now() - started);
        res.end(body);
      } catch (error) {
        if (!res.headersSent) res.writeHead(500);
        res.end(String(error));
      }
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: new URL(`https://localhost:${server.address().port}`),
    ca: join(directory, "ca.pem"),
    reports,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await dispose();
      if (!tlsDirectory) await rm(directory, { recursive: true, force: true });
    },
  };
}
