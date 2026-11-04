"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const files = ["index.demo.html", "dashboard.demo.html", "js/firebase-config-demo.js",
  "js/admin-auth.js", "js/admin-core.js", "js/admin-clinics.js", "js/admin-clinic-details.js",
  "js/admin-create-clinic.js", "css/login.css", "css/admin.css"];
const artifactFiles = [...files, "index.html"].sort();
// Release-only removal of local preview code. Source remains usable by offline tests.
// Exact anchors fail closed when the controller changes; never rewrite business logic.
function releaseContent(name, buffer) {
  if (!["js/admin-clinic-details.js", "css/admin.css"].includes(name)) return buffer;
  let text = buffer.toString("utf8").replace(/\r\n/g, "\n");
  const replace = (from, to) => {
    if (text.split(from).length !== 2) throw Error("Release transform anchor mismatch: " + name);
    text = text.replace(from, to);
  };
  if (name.endsWith(".css")) {
    const lines = text.split("\n");
    if (lines.filter(line => line.startsWith(".mock-controls")).length !== 3) throw Error("Preview CSS anchor mismatch");
    text = lines.filter(line => !line.startsWith(".mock-controls")).join("\n");
  } else {
    replace(`    // Only the isolated preview server adds this marker and adapter.
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
    provider = local && document.body.dataset.inneraPreview === "mock" && window.InneraClinicDetailsMock?.mode === "mock"
      ? window.InneraClinicDetailsMock
      : callableAdapter();`, `    provider = callableAdapter();`);
    replace(`    if (provider.mode === "mock") {
      card.append(el("p", "detail-notice", "本機 UI 模擬｜僅存於目前分頁記憶體，重新整理即重設，不會寫入雲端。"));
    }
`, "");
    replace(`      if (!result.operations && provider.mode === "mock") {
        readView.append(el("p", "detail-caption", "尚無本機營運資料，可點擊編輯開始填寫。"));
      } else if (!result.operations) {`, `      if (!result.operations) {`);
    replace('provider.mode === "mock" ? "儲存至本機 mock" : "儲存"', '"儲存"');
    replace('provider.mode === "mock" ? "正在儲存至本機 mock…" : "正在儲存…"', '"正在儲存…"');
    replace(`provider.mode === "mock"
          ? "已更新本機 mock；尚未儲存至雲端，重新整理即重設。" : "營運資料已儲存。"`, '"營運資料已儲存。"');
    replace(`        if (provider.mode === "mock" && !error?.code) {
          message.textContent = "本機模擬儲存失敗，輸入已保留，請再試一次。";
        } else {`, `        {`);
    replace('provider.mode === "mock" ? "試用資料已更新至本機 mock，未寫入雲端。" : "試用資料已儲存。"', '"試用資料已儲存。"');
    new vm.Script(text, { filename: name }); // Syntax validation only, no controller execution.
  }
  if (/mock|inneraPreview|data-innera-preview/i.test(text)) throw Error("Local preview code remains in release: " + name);
  return Buffer.from(text);
}
function safe(base, relative) {
  const target = path.resolve(base, relative);
  if (!target.startsWith(path.resolve(base) + path.sep)) throw Error("Path escapes workspace");
  let cursor = base;
  for (const part of relative.split(/[\\/]/)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Error("Symlinks are forbidden");
  }
  return target;
}
function inventory(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw Error("Symlinks are forbidden");
    const name = prefix + entry.name;
    if (entry.isDirectory()) return inventory(path.join(dir, entry.name), name + "/");
    if (!entry.isFile()) throw Error("Unexpected artifact entry");
    return [name];
  }).sort();
}
function validateArtifact(base = root) {
  const dir = safe(base, "dist/admin-demo");
  if (JSON.stringify(inventory(dir)) !== JSON.stringify(artifactFiles)) throw Error("Artifact allowlist mismatch");
  for (const name of artifactFiles) {
    const source = name === "index.html" ? "index.demo.html" : name;
    if (!releaseContent(source, fs.readFileSync(safe(base, source))).equals(fs.readFileSync(safe(base, "dist/admin-demo/" + name)))) throw Error("Artifact differs from reviewed source: " + name);
    const content = fs.readFileSync(path.join(dir, name), "utf8");
    if (/moodsogood-9e45b|firebase-config-prod\.js|admin\.innerahealthcare\.com/.test(content)) throw Error("Production reference in artifact: " + name);
    if (name.endsWith(".css")) {
      for (const match of content.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]));
        if (!artifactFiles.includes(resolved)) throw Error("Unexpected CSS resource");
      }
    }
  }
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(dir, "js/firebase-config-demo.js"), "utf8"), context, { timeout: 1000 });
  const env = context.window.INNERA_ADMIN_ENV;
  if (context.window.INNERA_FIREBASE_CONFIG?.projectId !== "innera-demo" || env?.projectId !== "innera-demo" ||
      env.loginUrl !== "index.demo.html" || env.dashboardUrl !== "dashboard.demo.html" ||
      env.staffActivationUrl !== "https://clinician.innerahealthcare.com/staff-activate-demo.html") throw Error("Demo environment mismatch");
  for (const name of artifactFiles.filter(name => name.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(dir, name), "utf8");
    if (/firebase-config-prod|dashboard\.html|data-innera-preview|clinic-details-mock/.test(html)) throw Error("Non-Demo HTML");
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const ref = match[1];
      if (ref.startsWith("https://www.gstatic.com/firebasejs/10.12.5/")) continue;
      if (ref.startsWith("#")) continue;
      if (!artifactFiles.includes(ref.replace(/^\.\//, ""))) throw Error("Unexpected resource: " + ref);
    }
  }
  const details = fs.readFileSync(path.join(dir, "js/admin-clinic-details.js"), "utf8");
  for (const marker of ['functions("asia-east1")', 'call("getClinicDetails"', 'call("updateClinicOperations"', 'call("updateClinicTrial"', 'innera:admin-ready']) {
    if (!details.includes(marker)) throw Error("Missing F1 integration: " + marker);
  }
  return dir;
}
function build(base = root) {
  const dir = safe(base, "dist/admin-demo");
  // Never clean an existing directory: unknown files cause rejection and remain intact.
  if (fs.existsSync(dir) && inventory(dir).some(name => !artifactFiles.includes(name))) throw Error("Unknown files in artifact; inspect manually");
  for (const name of artifactFiles) {
    const dest = safe(base, "dist/admin-demo/" + name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const source = name === "index.html" ? "index.demo.html" : name;
    fs.writeFileSync(dest, releaseContent(source, fs.readFileSync(safe(base, source))));
  }
  validateArtifact(base);
}
function validate(plan, base = root) {
  if (plan.project !== "innera-demo" || plan.target !== "admin-demo" || plan.config !== "firebase.hosting.demo.json") throw Error("Exact Demo project/target/config required");
  const config = JSON.parse(fs.readFileSync(safe(base, plan.config), "utf8"));
  if (Object.keys(config).join() !== "hosting" || Object.keys(config.hosting).sort().join() !== "headers,ignore,predeploy,public,target" || config.hosting.target !== "admin-demo" || config.hosting.public !== "dist/admin-demo" ||
      config.hosting.rewrites || config.hosting.redirects || JSON.stringify(config.hosting.ignore) !== "[]") throw Error("Unexpected Hosting config");
  if (JSON.stringify(config.hosting.predeploy) !== JSON.stringify(["node scripts/demo-hosting.cjs --check --project innera-demo --target admin-demo --config firebase.hosting.demo.json"])) throw Error("Unexpected predeploy hook");
  validateArtifact(base);
  const rc = JSON.parse(fs.readFileSync(safe(base, ".firebaserc"), "utf8"));
  const sites = rc.targets?.["innera-demo"]?.hosting?.["admin-demo"];
  if (!Array.isArray(sites) || sites.length !== 1 || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(sites[0]) || /REPLACE|moodsogood/i.test(sites[0])) throw Error("BLOCKED: verified Demo Hosting site mapping is required; see mapping example");
  return sites[0];
}
function main(args) {
  const mode = args.shift();
  if (mode === "--build" && !args.length) { build(); console.log("Demo artifact validated (11 files)"); return; }
  if (!["--check", "--execute"].includes(mode)) throw Error("Use --build, --check or --execute");
  const plan = {};
  while (args.length) {
    const key = args.shift(); const value = args.shift();
    if (!["--project", "--target", "--config"].includes(key) || !value || value.startsWith("--") || plan[key.slice(2)]) throw Error("Unknown, missing or duplicate argument");
    plan[key.slice(2)] = value;
  }
  const site = validate(plan);
  console.log("Validated Demo Hosting target:", site);
  if (mode === "--check") return;
  const result = spawnSync(process.platform === "win32" ? "firebase.cmd" : "firebase", ["deploy", "--project", "innera-demo", "--config", "firebase.hosting.demo.json", "--only", "hosting:admin-demo", "--non-interactive"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error || result.status !== 0) throw Error("Hosting deployment failed; no automatic retry");
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { build, validateArtifact, validate, files, artifactFiles, releaseContent };
