(async () => {
  const report = (data) =>
    fetch("/__acceptance/report", {
      method: "POST",
      body: JSON.stringify(data),
    });
  const wait = async (check) => {
    const end = Date.now() + 30000;
    while (!check()) {
      if (Date.now() > end) throw Error("Timeout: " + check);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const binaryName = "契約書 01.bin";
  const binaryPath = "/webdav/" + encodeURIComponent(binaryName);
  const binarySize = 256 * 1024 + 17;
  const byteAt = (offset) => (offset * 31 + Math.floor(offset / 256)) % 251;
  try {
    await wait(() => document.body.innerText.includes("seed.txt"));
    if (sessionStorage.getItem("acceptance-written")) {
      await wait(() => document.body.innerText.includes("accepted.txt"));
      const file = await fetch("/webdav/accepted.txt");
      if ((await file.text()) !== "Capacitor WebDAV acceptance")
        throw Error("Saved file differs");
      await wait(() => document.body.innerText.includes(binaryName));
      // Span native transfer boundaries and the short final segment.
      for (const [start, end] of [
        [0, 65535],
        [65536, 196608],
        [196609, binarySize - 1],
      ]) {
        const response = await fetch(binaryPath, {
          headers: { Range: `bytes=${start}-${end}` },
        });
        const chunk = new Uint8Array(await response.arrayBuffer());
        if (
          response.status !== 200 ||
          response.headers.has("content-range") ||
          response.headers.get("content-type") !== "application/octet-stream" ||
          chunk.length !== end - start + 1 ||
          !chunk.every((value, i) => value === byteAt(start + i))
        )
          throw Error(`Incorrect file bytes for range ${start}-${end}`);
      }
      await report({
        stage: "complete",
        platform: window.Capacitor?.getPlatform?.() ?? "browser",
      });
      return;
    }
    const denied = await fetch("/webdav/denied.txt", {
      method: "PUT",
      body: "unauthorized",
    });
    if (denied.status !== 401)
      throw Error("Unauthenticated write accepted: " + denied.status);
    const headers = {
      authorization: "Basic " + btoa("acceptance:test-password"),
    };
    const write = await fetch("/webdav/accepted.txt", {
      method: "PUT",
      headers: { ...headers, "content-type": "text/plain" },
      body: "Capacitor WebDAV acceptance",
    });
    if (!write.ok) throw Error("PUT failed: " + write.status);
    const binary = Uint8Array.from({ length: binarySize }, (_, i) => byteAt(i));
    const uploaded = await fetch(binaryPath, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/octet-stream" },
      body: binary,
    });
    if (!uploaded.ok) throw Error("Binary PUT failed: " + uploaded.status);
    const listing = await fetch("/webdav/", {
      method: "PROPFIND",
      headers: { ...headers, depth: "1" },
    });
    if (
      listing.status !== 207 ||
      !(await listing.text()).includes("accepted.txt")
    )
      throw Error("PROPFIND failed");
    sessionStorage.setItem("acceptance-written", "1");
    location.reload();
  } catch (error) {
    await report({
      stage: "failure",
      error: String(error),
      text: document.body.innerText,
    });
  }
})();
