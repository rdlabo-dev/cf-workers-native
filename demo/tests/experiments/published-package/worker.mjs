// Ordinary Workers application: no SDK imports or mobile-specific routes.
let submissions = 0;
const page = (body) =>
  new Response(
    `<!doctype html><html><head><title>Workers mobile acceptance</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${body}</body></html>`,
    { headers: { "content-type": "text/html;charset=utf-8" } },
  );
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/")
      return page('<h1>My Workers app</h1><a href="/details">Open details</a>');
    if (url.pathname === "/details")
      return page(
        '<h1>Details</h1><form method="post" action="/save"><input name="message" required><button type="submit">Save</button></form>',
      );
    if (url.pathname === "/save" && request.method === "POST") {
      const form = await request.formData();
      if (form.get("message") !== "From the mobile app")
        return new Response("Invalid input", { status: 400 });
      submissions++;
      return Response.redirect(new URL("/saved", url).href, 303);
    }
    if (url.pathname === "/saved")
      return page(`<h1>Saved</h1><output>${submissions}</output>`);
    return new Response("Not found", { status: 404 });
  },
};
