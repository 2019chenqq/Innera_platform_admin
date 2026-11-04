"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const guard = require("../scripts/demo-hosting.cjs");
const root = path.resolve(__dirname, "..");
const plan = { project: "innera-demo", target: "admin-demo", config: "firebase.hosting.demo.json" };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "innera-hosting-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of [...guard.files, plan.config]) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.copyFileSync(path.join(root, name), path.join(dir, name));
  }
  fs.writeFileSync(path.join(dir, ".firebaserc"), JSON.stringify({targets:{"innera-demo":{hosting:{"admin-demo":["test-only-demo-site"]}}}}));
  guard.build(dir); return dir;
}
test("artifact contains only allowlisted Demo assets and root login", t => {
  const dir = fixture(t); guard.validateArtifact(dir);
  assert.equal(fs.readFileSync(path.join(dir,"dist/admin-demo/index.html"),"utf8"),fs.readFileSync(path.join(dir,"index.demo.html"),"utf8"));
  assert.equal(guard.artifactFiles.length,11);
  assert.equal(guard.validate(plan,dir),"test-only-demo-site");
});
for (const [key,value] of [["project","moodsogood-9e45b"],["target","*"],["config","firebase.json"]]) {
  test("reject wrong " + key,t => assert.throws(()=>guard.validate({...plan,[key]:value},fixture(t)),/Exact Demo/));
}
for (const name of ["dashboard.html","js/firebase-config-prod.js","test/mock.js",".env"]) {
  test("reject forbidden artifact " + name,t=>{
    const dir=fixture(t), dest=path.join(dir,"dist/admin-demo",name);
    fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,"fixture");
    assert.throws(()=>guard.validateArtifact(dir),/allowlist/);
    assert.throws(()=>guard.build(dir),/Unknown files/);
    assert.equal(fs.readFileSync(dest,"utf8"),"fixture");
  });
}
test("reject stale or modified artifact",t=>{
  const dir=fixture(t); fs.appendFileSync(path.join(dir,"dist/admin-demo/js/admin-core.js"),"\n// altered");
  assert.throws(()=>guard.validate(plan,dir),/differs/);
});
test("release strips preview entry and mock branches without editing source; build is reproducible", t => {
  const dir = fixture(t), source = path.join(dir,"js/admin-clinic-details.js");
  const before = fs.readFileSync(source);
  const artifact = path.join(dir,"dist/admin-demo/js/admin-clinic-details.js");
  const first = fs.readFileSync(artifact);
  assert.doesNotMatch(first.toString(), /mock|inneraPreview|data-innera-preview/i);
  assert.match(first.toString(), /provider = callableAdapter\(\)/);
  for (const name of ["getClinicDetails","updateClinicOperations","updateClinicTrial"]) assert.ok(first.toString().includes(`call("${name}"`));
  assert.doesNotMatch(fs.readFileSync(path.join(dir,"dist/admin-demo/css/admin.css"),"utf8"), /mock-controls/);
  guard.build(dir);
  assert.ok(fs.readFileSync(source).equals(before));
  assert.ok(fs.readFileSync(artifact).equals(first));
});
test("release transform rejects changed preview anchors instead of silently retaining a local entry",t=>{
  const dir=fixture(t),source=path.join(dir,"js/admin-clinic-details.js");
  fs.writeFileSync(source,fs.readFileSync(source,"utf8").replace("const local =", "const previewLocal ="));
  assert.throws(()=>guard.build(dir),/anchor mismatch/);
});
test("reject Production project even when source and artifact both changed",t=>{
  const dir=fixture(t),file=path.join(dir,"js/firebase-config-demo.js");
  fs.writeFileSync(file,fs.readFileSync(file,"utf8").replaceAll("innera-demo","moodsogood-9e45b"));
  assert.throws(()=>guard.build(dir),/Production reference|environment mismatch/);
});
test("reject Production fallback in shared JS and missing resources",t=>{
  const dir=fixture(t),script=path.join(dir,"js/admin-core.js");
  fs.appendFileSync(script,'\n// https://admin.innerahealthcare.com');
  assert.throws(()=>guard.build(dir),/Production reference/);
});
test("reject unexpected stylesheet dependencies",t=>{
  const dir=fixture(t); fs.appendFileSync(path.join(dir,"css/admin.css"),'\nbody { background: url(https://example.invalid/a.png) }');
  assert.throws(()=>guard.build(dir),/Unexpected CSS/);
});
test("missing and placeholder mappings block deployment",t=>{
  const dir=fixture(t);
  for(const rc of [{},JSON.parse(fs.readFileSync(path.join(root,"firebase.hosting.demo.mapping.example.json"),"utf8"))]) {
    fs.writeFileSync(path.join(dir,".firebaserc"),JSON.stringify(rc));
    assert.throws(()=>guard.validate(plan,dir),/mapping is required/);
  }
});
test("reject widened Hosting config",t=>{
  const dir=fixture(t),file=path.join(dir,plan.config),config=JSON.parse(fs.readFileSync(file));
  config.functions={source:"functions"};fs.writeFileSync(file,JSON.stringify(config));
  assert.throws(()=>guard.validate(plan,dir),/Unexpected Hosting/);
});
test("check never launches Firebase and rejects CLI expansion",t=>{
  const dir=fixture(t);fs.mkdirSync(path.join(dir,"scripts"));fs.copyFileSync(path.join(root,"scripts/demo-hosting.cjs"),path.join(dir,"scripts/demo-hosting.cjs"));
  const args=[path.join(dir,"scripts/demo-hosting.cjs"),"--check","--project","innera-demo","--target","admin-demo","--config",plan.config];
  const run=extra=>spawnSync(process.execPath,[...args,...extra],{encoding:"utf8",env:{...process.env,PATH:""}});
  assert.equal(run([]).status,0);
  for(const extra of [["--only","hosting"],["--force"],["--execute"],["--project","innera-demo"]])assert.equal(run(extra).status,1);
});
