(async () => {
  const report = (data) =>
    fetch("/__acceptance/report", {
      method: "POST",
      body: JSON.stringify(data),
    });
  const wait = async (f) => {
    const end = Date.now() + 30000;
    while (!f()) {
      if (Date.now() > end) throw Error("Timed out: " + f);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const fill = (input, value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const body = "買い物メモ 📝 — café と牛乳";
  const editor = () =>
    document.querySelector(".cm-content[contenteditable=true]");
  try {
    if (!sessionStorage.getItem("acceptance-created")) {
      await wait(
        () => document.querySelectorAll('input[type="password"]').length === 2,
      );
      const inputs = [...document.querySelectorAll("form input")];
      fill(inputs[0], "acceptance");
      fill(inputs[1], "Acceptance-password-29");
      fill(inputs[2], "Acceptance-password-29");
      await new Promise((r) => setTimeout(r, 50));
      document.querySelector('button[type="submit"]').click();
      await wait(() => document.querySelector('button[aria-label="New note"]'));
      document.querySelector('button[aria-label="New note"]').click();
      await wait(() =>
        document.querySelector('input[aria-label="Note title"]'),
      );
      fill(
        document.querySelector('input[aria-label="Note title"]'),
        "Capacitor acceptance note",
      );
      document.querySelector('input[aria-label="Note title"]').blur();
      await wait(
        () =>
          document.body.innerText.includes("Capacitor acceptance note") ||
          document.querySelector('input[aria-label="Note title"]')?.value ===
            "Capacitor acceptance note",
      );
      await wait(editor);
      editor().focus();
      if (!document.execCommand("insertText", false, body))
        throw Error("Editor rejected text insertion");
      // Reload only after the original autosave request has persisted server-side.
      const end = Date.now() + 15000;
      while (Date.now() < end) {
        const res = await fetch("/api/notes");
        const { notes } = await res.json();
        const note = notes.find(
          (note) => note.title === "Capacitor acceptance note",
        );
        if (
          note &&
          (await (await fetch(`/api/notes/${note.id}`)).json()).content === body
        ) {
          sessionStorage.setItem("acceptance-created", note.id);
          location.reload();
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error("Note did not persist");
    }
    await wait(
      () =>
        document.body.innerText.includes("Capacitor acceptance note") ||
        document.querySelector('input[aria-label="Note title"]')?.value ===
          "Capacitor acceptance note",
    );
    if (editor()?.textContent !== body) {
      const noteId = sessionStorage.getItem("acceptance-created");
      const option = () => document.getElementById("note-option-" + noteId);
      await wait(option);
      option().click();
      const mobileEdit = [
        ...document.querySelectorAll("nav.mobile-bottom-nav button"),
      ].find((button) => button.textContent.trim() === "Edit");
      if (mobileEdit) {
        await wait(() => !mobileEdit.disabled);
        mobileEdit.click();
      }
    }
    await wait(() => editor()?.textContent === body);
    await report({
      stage: "complete",
      platform: window.Capacitor?.getPlatform?.() ?? "browser",
    });
  } catch (error) {
    await report({
      stage: "failure",
      error: String(error),
      editorText: editor()?.textContent,
      editorMarkup: document.querySelector(".cm-content")?.outerHTML.slice(0, 1500),
      text: document.body.innerText,
    });
  }
})();
