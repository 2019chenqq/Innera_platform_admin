"use strict";
// node test/clinic-details-preview.cjs -> http://127.0.0.1:4173/dashboard.demo.html
// Serves only an allowlist; never proxies Firebase or exposes repository files.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const allowed = new Set([
  "dashboard.html", "dashboard.demo.html", "css/admin.css",
  "js/admin-clinics.js", "js/admin-clinic-details.js", "js/admin-create-clinic.js",
  "test/clinic-details-mock.js"
]);
function previewHtml(html) {
  return html.replace("<body>", '<body data-innera-preview="mock">').replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g, tag =>
    /firebase|admin-core/.test(tag) ? "" : tag
  ).replace('<script src="./js/admin-clinics.js">',
    '<script src="./test/clinic-details-mock.js"></script>\n<script src="./js/admin-clinics.js">');
}
function createServer(options = {}) {
  return http.createServer(async (req, res) => {
    const file = new URL(req.url, "http://127.0.0.1").pathname.slice(1) || "dashboard.demo.html";
    // Test-only transport to real callable handlers backed by a local Emulator.
    if (options.callableHandler && file === "__callable" && req.method === "POST") {
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 50000) throw new Error("Request too large");
        }
        const result = await options.callableHandler(JSON.parse(body));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: result }));
      } catch (error) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: `functions/${error.code || "internal"}`, details: error.details } }));
      }
      return;
    }
    if (!allowed.has(file)) { res.writeHead(404); res.end("Not found"); return; }
    const source = options.releaseArtifact && ["js/admin-clinic-details.js", "css/admin.css"].includes(file)
      ? path.join(root, "dist/admin-demo", file) : path.join(root, file);
    let content = fs.readFileSync(source, "utf8");
    if (file.endsWith(".html")) content = previewHtml(content);
    res.writeHead(200, {
      "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css" : "text/javascript",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'self'; connect-src ${options.callableHandler ? "'self'" : "'none'"}; img-src 'none'; style-src 'self'; script-src 'self'; form-action 'none'; base-uri 'none'`
    });
    res.end(content);
  });
}
if (require.main === module) {
  createServer().listen(4173, "127.0.0.1", () => console.log("Offline F1-A preview: http://127.0.0.1:4173/dashboard.demo.html"));
}
module.exports = { createServer, previewHtml };
