"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const routes = {
  "/": ["index.html", "text/html"],
  "/probe.js": ["probe.js", "application/javascript"],
  "/config.js": ["../../js/firebase-config-demo.js", "application/javascript"],
};
http.createServer((req, res) => {
  const route = routes[req.url];
  if (!route || !["GET", "HEAD"].includes(req.method)) {res.writeHead(404);res.end();return;}
  res.writeHead(200, {"Content-Type":route[1]+"; charset=utf-8", "Cache-Control":"no-store", "Referrer-Policy":"no-referrer", "X-Content-Type-Options":"nosniff"});
  res.end(req.method === "HEAD" ? undefined : fs.readFileSync(path.resolve(__dirname,route[0])));
}).listen(8789,"127.0.0.1",()=>console.log("F2-I local page: http://127.0.0.1:8789/ (no request logging)"));
