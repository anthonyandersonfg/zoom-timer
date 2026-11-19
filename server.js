import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const routes = new Map([
  ["/", ["index.html", "text/html"]],
  ["/installed.html", ["installed.html", "text/html"]],
  ["/timer.css", ["timer.css", "text/css"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/timer.js", ["timer.js", "text/javascript"]],
  ["/zoom.js", ["zoom.js", "text/javascript"]],
]);

const headers = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; script-src 'self' https://appssdk.zoom.us; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' https://zoom.us https://*.zoom.us",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
};

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { ...headers, Allow: "GET, HEAD" }).end();
    return;
  }

  const route = routes.get(request.url.split("?")[0]);
  if (!route) {
    response.writeHead(404, headers).end();
    return;
  }

  const [file, type] = route;
  try {
    const body = await readFile(new URL(`./public/${file}`, import.meta.url));
    response.writeHead(200, {
      ...headers,
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Length": body.length,
    }).end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    console.error(error);
    response.writeHead(500, headers).end();
  }
});

const port = Number(process.env.PORT || 8765);
const host = process.env.BIND_HOST || "127.0.0.1";
server.listen(port, host, () => console.log(`Host Timer listening on ${host}:${port}`));
