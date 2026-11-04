"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const secret = "SECRET_INVITE_TOKEN";
function setup(demo, options = {}) {
  const nodes = new Map(); const listeners = {}; const logs = []; const alerts = []; const calls = []; const mails = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { value: "Test", textContent: "", disabled: false, listeners: {}, classList: { add(){}, remove(){} }, reset(){},
      addEventListener(name, fn){this.listeners[name]=fn;}, querySelector(){return node("submit");} });
    return nodes.get(id);
  }
  const db = { collection: () => ({ get: async () => ({ docs: [] }) }) };
  const context = { URL, setTimeout: () => {}, alert: text => alerts.push(text),
    document: { getElementById: node, addEventListener: (name, fn) => { listeners[name] = fn; } },
    console: Object.fromEntries(["info","log","warn","error"].map(k=>[k,(...args)=>logs.push(args)])),
    firebase: {
      app: () => ({ functions: region => { assert.equal(region,"asia-east1"); return { httpsCallable: name => async input => {
        calls.push({name,input}); if(options.backendError) throw options.backendError;
        return { data: { success: true, inviteId: "invite", token: secret, adminEmail: "owner@example.test", clinicCode: "CL00001", ...options.result } };
      } }; } }),
      auth: () => ({ sendSignInLinkToEmail: async (email, settings) => { mails.push({email,settings}); if(options.mailError) throw options.mailError; } }),
    },
  };
  context.window = { confirm: () => true, InneraAdminCore: { init: () => { if (options.environmentMismatch) throw new Error("環境不一致"); }, getDb: () => db } };
  vm.createContext(context);
  for (const file of [`js/firebase-config-${demo ? "demo" : "prod"}.js`, "js/admin-create-clinic.js", "js/admin-clinics.js"]) vm.runInContext(fs.readFileSync(path.join(root,file),"utf8"),context);
  listeners.DOMContentLoaded();
  return { nodes, logs, alerts, calls, mails, context,
    create: () => node("createClinicForm").listeners.submit({preventDefault(){}}),
    resend: () => node("clinicList").listeners.click({target:{closest:selector=>selector === ".clinic-resend-invite-button" ? {dataset:{clinicId:"clinic",clinicName:"Test"}} : null}}),
    output: () => JSON.stringify({logs, alerts, message:node("createClinicMessage").textContent}),
  };
}
for (const demo of [false,true]) {
  const env = demo ? "Demo" : "Production";
  test(`${env}: confirmed create and accepted mail preserve correct environment/link`, async () => {
    const app=setup(demo); await app.create();
    assert.match(app.nodes.get("createClinicMessage").textContent,/Firebase 已接受寄信請求/);
    const url=new URL(app.mails[0].settings.url);
    assert.equal(url.pathname,demo ? "/staff-activate-demo.html" : "/staff-activate.html");
    assert.equal(url.searchParams.get("token"),secret); assert.equal(url.searchParams.get("invite"),"invite");
    assert.equal(app.context.window.INNERA_FIREBASE_CONFIG.projectId,demo ? "innera-demo" : "moodsogood-9e45b");
    assert.ok(!app.output().includes(secret));
  });
  test(`${env}: successful create followed by mail failure is not creation failure`, async () => {
    const app=setup(demo,{mailError:{message:`https://example.test/?token=${secret}`,code:secret}});await app.create();
    assert.match(app.nodes.get("createClinicMessage").textContent,/院所及啟用邀請已建立，但寄信請求失敗/);
    assert.equal(app.calls.length,1);assert.ok(!app.output().includes(secret));
  });
  test(`${env}: timeout is uncertain and never retries or sends email`, async () => {
    const app=setup(demo,{backendError:{code:"functions/deadline-exceeded",message:secret}});await app.create();
    assert.match(app.nodes.get("createClinicMessage").textContent,/無法確認.*重新整理/);
    assert.equal(app.calls.length,1);assert.equal(app.mails.length,0);assert.ok(!app.output().includes(secret));
  });
  test(`${env}: confirmed rotation followed by mail failure preserves rotation outcome`, async () => {
    const app=setup(demo,{mailError:{message:secret}});await app.resend();
    assert.match(app.alerts[0],/邀請已輪替.*舊邀請連結已失效/);assert.equal(app.calls.length,1);assert.ok(!app.output().includes(secret));
  });
  test(`${env}: accepted resend does not claim delivery`, async () => {
    const app=setup(demo);await app.resend();assert.match(app.alerts[0],/Firebase 已接受寄信請求.*不代表收件人已收到/);assert.ok(!app.output().includes(secret));
  });
  test(`${env}: malformed confirmed invitation and arbitrary backend error never leak payload`, async () => {
    const app=setup(demo,{result:{token:null}});await app.create();assert.match(app.nodes.get("createClinicMessage").textContent,/院所已建立.*資料不完整/);assert.equal(app.mails.length,0);
    const failed=setup(demo,{backendError:{code:"functions/invalid-argument",message:secret,details:{token:secret}}});await failed.create();assert.ok(!failed.output().includes(secret));
  });
  test(`${env}: HTML pages retain shared scripts and environment-specific configuration`, () => {
    const html=fs.readFileSync(path.join(root,demo?"dashboard.demo.html":"dashboard.html"),"utf8");
    for(const file of ["admin-create-clinic.js","admin-clinics.js",`firebase-config-${demo?"demo":"prod"}.js`]) assert.ok(html.includes(file));
  });
}

for (const demo of [false, true]) {
  test(`${demo ? "Demo" : "Production"}: environment guard blocks create and resend before any backend/mail call`, async () => {
    const app = setup(demo, { environmentMismatch: true });
    await app.create(); await app.resend();
    assert.equal(app.calls.length, 0); assert.equal(app.mails.length, 0);
  });
}
