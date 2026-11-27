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
  window.addEventListener(
    "error",
    (e) =>
      void report({ stage: "failure", error: String(e.error ?? e.message) }),
  );
  window.addEventListener(
    "unhandledrejection",
    (e) => void report({ stage: "failure", error: String(e.reason) }),
  );
  const filename = "色見本.png";
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4ysDAsEUZAAdQAc2jcHAoAAAAAElFTkSuQmCC";
  const filePhase = sessionStorage.getItem("acceptance-text-id");
  try {
    if (location.pathname === "/") {
      await wait(
        () =>
          Object.getOwnPropertyDescriptor(
            document.querySelector("textarea") ?? {},
            "value",
          )?.set,
      );
      if (filePhase) {
        const files = new DataTransfer();
        files.items.add(
          new File(
            [Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
            filename,
            { type: "image/png" },
          ),
        );
        const picker = document.querySelector('input[type="file"]');
        picker.files = files.files;
        picker.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(() =>
          document.querySelector(
            'button[aria-label="Remove ' + filename + '"]',
          ),
        );
        document.querySelector('button[type="submit"]').click();
        return;
      }
      const input = document.querySelector("textarea");
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      ).set.call(input, "Capacitor encrypted acceptance");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
      document.querySelector('button[type="submit"]').click();
    } else if (location.pathname.startsWith("/p/")) {
      if (!location.hash)
        throw Error("Encryption key was lost during navigation");
      const id = location.pathname.split("/").pop();
      if (filePhase) {
        const preview = () =>
          document.querySelector('img[alt="' + filename + '"]');
        await wait(
          () => preview()?.naturalWidth === 2 && preview()?.naturalHeight === 1,
        );
        const canvas = document.createElement("canvas");
        canvas.width = 2;
        canvas.height = 1;
        const context = canvas.getContext("2d");
        context.drawImage(preview(), 0, 0);
        const pixels = context.getImageData(0, 0, 2, 1).data;
        if (pixels.join(",") !== "245,0,0,255,0,180,35,255")
          throw Error(
            "Decrypted image has unexpected pixels: " + pixels.join(","),
          );
        await report({
          stage: "complete",
          id: filePhase,
          fileId: id,
          platform: window.Capacitor?.getPlatform?.() ?? "browser",
        });
        return;
      }
      await wait(() =>
        document
          .querySelector(".code-lines")
          ?.textContent.includes("Capacitor encrypted acceptance"),
      );
      sessionStorage.setItem("acceptance-text-id", id);
      location.assign("/");
    }
  } catch (error) {
    await report({
      stage: "failure",
      error: String(error),
      text: document.body.innerText,
    });
  }
})();
