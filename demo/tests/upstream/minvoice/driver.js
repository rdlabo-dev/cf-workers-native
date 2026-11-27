(async () => {
  if (window.top !== window) return;
  const report = (data) =>
    fetch("/__acceptance/report", {
      method: "POST",
      body: JSON.stringify({ ...data, path: location.pathname }),
    });
  const fill = (name, value, index = 0) => {
    const el = document.getElementsByName(name)[index];
    if (!el) throw Error("Missing field " + name);
    el.value = value;
    return el;
  };
  try {
    const path = location.pathname;
    if (document.body.innerText.includes("Cross-site request blocked"))
      throw Error("Upstream CSRF rejected native form submission");
    if (path === "/admin/login")
      fill("password", "native-test-only-password").form.requestSubmit();
    else if (path === "/admin") {
      await report({ stage: "login" });
      // A sandboxed opaque-origin form must not inherit the main document's trust.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("CSRF attempt did not execute")),
          5000,
        );
        const frame = document.createElement("iframe");
        frame.setAttribute("sandbox", "allow-scripts allow-forms");
        frame.hidden = true;
        frame.srcdoc = `<form method="post" action="${location.protocol}//${location.host}/admin/clients"><input name="name" value="CSRF Intruder"></form><script>document.forms[0].submit();parent.postMessage("csrf-attempted", "*")<\/script>`;
        const attempted = (event) => {
          if (
            event.source !== frame.contentWindow ||
            event.data !== "csrf-attempted"
          )
            return;
          window.removeEventListener("message", attempted);
          clearTimeout(timer);
          void report({ stage: "csrf-attempted" }).then(() =>
            setTimeout(resolve, 1000),
          );
        };
        window.addEventListener("message", attempted);
        document.body.append(frame);
      });
      location.href = "/admin/clients/new";
    } else if (path === "/admin/clients/new") {
      fill("name", "Capacitor Client");
      fill("email", "acceptance@example.invalid").form.requestSubmit();
    } else if (path === "/admin/clients") {
      if (!document.body.innerText.includes("Capacitor Client"))
        throw Error("Client missing");
      await report({ stage: "client" });
      location.href = "/admin/invoices/new";
    } else if (path === "/admin/invoices/new") {
      const client = document.querySelector('select[name="client_id"]');
      client.value = [...client.options].find((o) =>
        o.textContent.includes("Capacitor Client"),
      ).value;
      fill("subject", "Native invoice");
      fill("item_description[]", "Native line item");
      fill("item_quantity[]", "2");
      fill("item_unit_price[]", "12.50");
      document.getElementById("add-line-btn").click();
      fill("item_description[]", "設計 & café + 仕上げ", 1);
      fill("item_quantity[]", "1.5", 1);
      fill("item_unit_price[]", "3.20", 1).form.requestSubmit();
    } else if (/^\/admin\/invoices\/\d+$/.test(path)) {
      if (
        !["Native invoice", "Native line item", "設計 & café + 仕上げ"].every(
          (text) => document.body.innerText.includes(text),
        )
      )
        throw Error("Invoice missing");
      await report({
        stage: "complete",
        platform: window.Capacitor?.getPlatform?.(),
      });
    } else throw Error("Unexpected page " + path);
  } catch (error) {
    await report({
      stage: "failure",
      error: String(error),
      text: document.body.innerText,
    });
  }
})();
