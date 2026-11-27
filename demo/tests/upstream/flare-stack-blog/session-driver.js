import { createAuthClient } from "better-auth/client";

(async () => {
  const report = (data) =>
    fetch("/__acceptance/report", {
      method: "POST",
      body: JSON.stringify(data),
    });
  try {
    const origin = document.body.dataset.authOrigin;
    const client = createAuthClient({
      baseURL: origin,
      fetchOptions: {
        customFetchImpl(input, init) {
          const url = new URL(input);
          if (url.origin !== origin || !url.pathname.startsWith("/api/auth/"))
            throw Error("Unexpected authentication URL");
          return fetch(url.pathname + url.search, {
            ...init,
            mode: "same-origin",
          });
        },
      },
    });
    async function user() {
      const result = await client.getSession({
        query: { disableCookieCache: true },
      });
      if (result.error) throw Error("getSession: " + result.error.status);
      return result.data?.user.email;
    }
    const email = "reader@example.com";
    if (location.pathname === "/session-test") {
      const direct = createAuthClient({ baseURL: origin });
      let blocked = false;
      try {
        await direct.getSession({ query: { cors: "omit" } });
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        blocked = true;
      }
      if (!blocked) throw Error("Expected unreadable cross-origin response");
      const allowed = await direct.getSession({ query: { cors: "allow" } });
      if (allowed.error || allowed.data !== null)
        throw Error("Expected readable anonymous response");
      await report({
        stage: "cors-control",
        platform: window.Capacitor.getPlatform(),
      });
      if (await user()) throw Error("Expected anonymous session");
      const result = await client.signIn.email({
        email,
        password: "local-fixture-password",
      });
      if (result.error) throw Error("signIn: " + JSON.stringify(result.error));
      if ((await user()) !== email) throw Error("Expected signed-in reader");
      location.href = "/session-test/account";
    } else {
      if (
        document.querySelector("h1")?.textContent !== email ||
        (await user()) !== email
      )
        throw Error("Expected authenticated page");
      if (!sessionStorage.getItem("reloaded")) {
        sessionStorage.setItem("reloaded", "1");
        location.reload();
        return;
      }
      const result = await client.signOut();
      if (result.error) throw Error("signOut: " + JSON.stringify(result.error));
      if (await user())
        throw Error("Expected anonymous session after sign-out");
      const account = await fetch("/session-test/account");
      if (account.status !== 401)
        throw Error("Expected protected page to reject after sign-out");
      await report({
        stage: "complete",
        platform: window.Capacitor.getPlatform(),
      });
    }
  } catch (error) {
    await report({ stage: "failure", error: String(error) });
  }
})();
