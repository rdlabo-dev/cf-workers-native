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
  try {
    if (location.pathname === "/login") {
      const phase = sessionStorage.getItem("acceptance-phase");
      if (phase === "logout") {
        if (document.cookie.includes("tsrss_session"))
          throw Error("Session cookie exposed");
        await report({
          stage: "complete",
          platform: window.Capacitor?.getPlatform?.() ?? "browser",
        });
        return;
      }
      const input = document.querySelector('input[name="password"]');
      if (phase === "invalid") {
        if (!document.body.innerText.includes("Invalid password"))
          throw Error("Invalid password was accepted");
        await report({ stage: "invalid-password" });
        input.value = "acceptance-password";
        sessionStorage.setItem("acceptance-phase", "login");
      } else {
        input.value = "wrong-password";
        sessionStorage.setItem("acceptance-phase", "invalid");
      }
      input.form.requestSubmit();
      return;
    }
    if (sessionStorage.getItem("acceptance-phase") !== "login")
      throw Error("Protected page loaded before login");
    if (document.cookie.includes("tsrss_session"))
      throw Error("HttpOnly session exposed");
    await wait(
      () =>
        document.querySelector(".article-title")?.textContent ===
        "Capacitor acceptance article",
    );
    document.querySelector(".article-star").click();
    await wait(() => document.querySelector(".article-star.starred"));
    document.querySelector(".article-header").click();
    await wait(() =>
      document
        .querySelector(".article-content")
        ?.textContent.includes("Full article content"),
    );
    // Observe persistence through the real authenticated API before logging out.
    const article = await (await fetch("/api/articles/1")).json();
    if (!article.is_read || !article.is_starred)
      throw Error("Article state was not saved");
    const xml = `<opml version="2.0"><body>
<outline text="購読 &amp; テスト">
<outline text="New feed" xmlUrl="https://feeds.example.invalid/design.xml"/>
</outline>
<outline text="Existing feed" xmlUrl="https://example.com/feed.xml"/>
</body></opml>`;
    async function importSubscriptions(file, expected) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/opml/import", {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw Error("OPML import HTTP " + res.status);
      const counts = await res.json();
      if (Object.keys(expected).some((key) => counts[key] !== expected[key]))
        throw Error("OPML import counts " + JSON.stringify(counts));
    }
    await importSubscriptions(
      new File([xml], "日本語の購読.opml", { type: "application/xml" }),
      { imported: 1, skipped: 1, total: 2 },
    );
    const exported = await fetch("/api/opml/export");
    if (
      !exported.ok ||
      exported.headers.get("content-disposition") !==
        "attachment; filename=tsrss-feeds.opml" ||
      exported.headers.get("content-type")?.split(";")[0] !== "application/xml"
    )
      throw Error("OPML export headers");
    const bytes = await exported.blob();
    const parsed = new DOMParser().parseFromString(
      await bytes.text(),
      "application/xml",
    );
    const urls = [...parsed.querySelectorAll("outline[xmlUrl]")]
      .map((outline) => outline.getAttribute("xmlUrl"))
      .sort();
    const importedFeed = parsed.querySelector(
      'outline[xmlUrl="https://feeds.example.invalid/design.xml"]',
    );
    if (
      parsed.querySelector("parsererror") ||
      importedFeed?.getAttribute("title") !== "設計 & café" ||
      importedFeed.parentElement?.getAttribute("text") !== "購読 & テスト" ||
      urls.length !== 2 ||
      urls[0] !== "https://example.com/feed.xml" ||
      urls[1] !== "https://feeds.example.invalid/design.xml"
    )
      throw Error("OPML export did not preserve subscriptions");
    await importSubscriptions(
      new File([bytes], "tsrss-feeds.opml", { type: "application/xml" }),
      { imported: 0, skipped: 2, total: 2 },
    );
    sessionStorage.setItem("acceptance-phase", "logout");
    document.querySelector("#btn-logout").click();
  } catch (error) {
    await report({
      stage: "failure",
      error: String(error),
      text: document.body.innerText,
    });
  }
})();
