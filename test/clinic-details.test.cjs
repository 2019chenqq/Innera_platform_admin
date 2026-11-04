"use strict";
// Actual DOM/browser tests, offline. Requires local Chrome/Edge and Node 24.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createServer, previewHtml } = require("./clinic-details-preview.cjs");
const root = path.resolve(__dirname, "..");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

describe("F1 details isolated browser", { concurrency: false }, () => {
  let server, browser, profile, socket, origin, client, nextId = 0;
  let confirmResult = true, dialogs = 0;
  let navigation = 0;
  let previewOptions;
  const pending = new Map();
  const requests = [];
  let emulatorApp, emulatorDb, deleteEmulatorApp, emulatorLoaded;
  let loseTrialResponse = false;
  const backendRoot = path.resolve(root, "../moodsogood_app/functions");
  async function callableHook(demo = true, remote = false) {
    const config = fs.readFileSync(path.join(root, `js/firebase-config-${demo ? "demo" : "prod"}.js`), "utf8");
    return command("Page.addScriptToEvaluateOnNewDocument", { source: `
      ${config}
      document.addEventListener('DOMContentLoaded',()=>{
        delete document.body.dataset.inneraPreview;
        window.__calls=[];
        window.__failure=null;
        window.__stored=null;
        window.__revision=0;
        window.__delay=0;
        window.__empty=()=>({contactName:'',contactTitle:'',contactEmail:'',contactPhone:'',clinicType:'',cooperationNotes:''});
        window.__app={options:{projectId:INNERA_ADMIN_ENV.projectId}, functions:region=>({
          httpsCallable:name=>async input=>{
            __calls.push({name,input,region,projectId:__app.options.projectId});
            await new Promise(r=>setTimeout(r,__delay));
            if (__failure) throw __failure;
            if (${remote}) {
              const response=await fetch('/__callable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,input})});
              const payload=await response.json(); if(payload.error) throw payload.error; return payload;
            }
            if(input.clinicId==='missing') throw {code:'functions/not-found'};
            if(window.__trialBridge) {
              if(name==='getClinicDetails') return {data:await InneraClinicDetailsMock.load(input.clinicId)};
              if(name==='updateClinicTrial') return {data:await InneraClinicDetailsMock.saveTrial(input.clinicId,input.action,
                input.action==='setStart'?{startDate:input.startDate}:{reason:input.reason},input.expectedRevision)};
            }
            if(name==='getClinicDetails') return {data:{
              clinic:{name:'Callable '+input.clinicId,clinicCode:'CALL01'},operations:__stored,
              trial:null,trialComputed:{status:'not_configured',remainingDays:null,expiresAt:null,lastTrialDate:null,endDateExclusive:null},
              evaluatedAt:{seconds:Math.floor(Date.now()/1000),nanoseconds:0},
              revision:__revision, updatedAt:__revision?{seconds:1800000000,nanoseconds:0}:null
            }};
            __stored={...input.operations}; __revision=input.expectedRevision+1;
            return {data:{operations:__stored,revision:__revision,updatedAt:{seconds:1800000000,nanoseconds:0}}};
          }
        })};
        firebase.app=()=>__app;
      });
    ` });
  }
  async function removeHook(hook) {
    await command("Page.removeScriptToEvaluateOnNewDocument", { identifier: hook.identifier });
  }
  async function eventually(fn, timeout = 7000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await fn();
      if (result) return result;
      await sleep(25);
    }
    throw new Error("Timed out waiting for browser state");
  }
  function command(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  }
  const text = () => evaluate("document.getElementById('clinicDetailView').innerText");
  async function open(hash = "#clinic/mock-a", page = "dashboard.demo.html") {
    confirmResult = true;
    const url = `${origin}/${page}?test=${++navigation}${hash}`;
    await command("Page.navigate", { url });
    await eventually(() => evaluate(`location.href === ${JSON.stringify(url)} && !!document.querySelector('.mock-controls')`));
    if (hash.startsWith("#clinic/")) await eventually(async () => !(await text()).includes("正在讀取"));
    else await eventually(() => evaluate("document.querySelectorAll('.clinic-details-link').length === 3"));
  }
  async function click(label, scope = "#clinicDetailView") {
    await evaluate(`(() => {
      const node = [...document.querySelectorAll(${JSON.stringify(scope)} + ' button, ' + ${JSON.stringify(scope)} + ' a')].find(n => n.textContent === ${JSON.stringify(label)});
      if (!node) throw new Error('Missing control: ' + ${JSON.stringify(label)});
      node.click();
    })()`);
  }
  async function go(id) {
    await evaluate(`window.location.hash = ${JSON.stringify("#clinic/" + id)}`);
    await eventually(async () => (await text()).includes(id) && !(await text()).includes("正在讀取"));
  }
  async function edit(values) {
    await click("編輯");
    for (const [key, value] of Object.entries(values)) {
      await evaluate(`document.getElementById(${JSON.stringify("operation-" + key)}).value = ${JSON.stringify(value)}`);
    }
  }
  async function submit() {
    await evaluate("document.querySelector('.operations-form').requestSubmit()");
  }
  before(async () => {
    const options = previewOptions = {};
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^127\.0\.0\.1:\d+$/);
      const { initializeApp, deleteApp } = require(require.resolve("firebase-admin/app", { paths: [backendRoot] }));
      const { getFirestore } = require(require.resolve("firebase-admin/firestore", { paths: [backendRoot] }));
      emulatorApp = initializeApp({ projectId: "demo-innera-f1c-ui" }, "f1c-ui");
      deleteEmulatorApp = deleteApp;
      emulatorDb = getFirestore(emulatorApp);
      await emulatorDb.doc("platformAdmins/platform").set({ role: "platform_admin", status: "active" });
      await emulatorDb.doc("clinics/f1c").set({ name: "Local Emulator Clinic", status: "inactive", phone: "unchanged" });
      await emulatorDb.doc("clinicOperations/f1c").delete();
      const { loadPlatform } = require(path.join(backendRoot, "test/clinic/platform_test_support.cjs"));
      // The existing helper evaluates handlers in a VM. Adapt its callback
      // promise to this realm, as the backend Emulator tests already do.
      const loaded = emulatorLoaded = loadPlatform("functions", {
        collection: name => emulatorDb.collection(name),
        runTransaction: callback => emulatorDb.runTransaction(async tx => await callback(tx)),
      });
      options.callableHandler = async ({ name, input }) => {
        if (!["getClinicDetails", "updateClinicOperations", "updateClinicTrial"].includes(name)) throw new Error("Unsupported test callable");
        const result = await loaded.functions[name].run({ auth: { uid: "platform" }, data: input });
        if (name === "updateClinicTrial" && loseTrialResponse) {
          const error = new Error("Injected lost response after actual Emulator commit"); error.code = "deadline-exceeded"; throw error;
        }
        return result;
      };
    }
    server = createServer(options);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    const executable = process.env.INNERA_TEST_BROWSER || [
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
    ].find(file => fs.existsSync(file));
    assert.ok(executable, "Set INNERA_TEST_BROWSER to a local Chrome/Edge executable");
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "innera-f1a-browser-"));
    browser = spawn(executable, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--disable-background-networking", "--disable-component-update", "--disable-sync",
      "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"
    ], { windowsHide: true, stdio: "ignore" });
    browser.on("error", error => { console.error(error.message); });
    const portFile = path.join(profile, "DevToolsActivePort");
    await eventually(() => fs.existsSync(portFile), 15000);
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0];
    client = `http://127.0.0.1:${port}`;
    const tabs = await (await fetch(`${client}/json`)).json();
    socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
    socket.addEventListener("message", event => {
      const data = JSON.parse(event.data);
      if (data.id) {
        const promise = pending.get(data.id);
        if (!promise) return;
        pending.delete(data.id);
        if (data.error) promise.reject(new Error(data.error.message));
        else promise.resolve(data.result);
      } else if (data.method === "Page.javascriptDialogOpening") {
        dialogs++;
        command("Page.handleJavaScriptDialog", { accept: confirmResult }).catch(() => {});
      } else if (data.method === "Network.requestWillBeSent") requests.push(data.params.request.url);
    });
    await command("Page.enable");
    await command("Runtime.enable");
    await command("Network.enable");
  });
  after(async () => {
    if (socket?.readyState === WebSocket.OPEN) {
      // Closing the browser terminates the isolated profile, never a user browser.
      command("Browser.close").catch(() => {});
      await sleep(400);
      socket.close();
    }
    if (browser && browser.exitCode === null) browser.kill();
    if (server) await new Promise(resolve => server.close(resolve));
    if (emulatorDb) await emulatorDb.terminate();
    if (emulatorApp) await deleteEmulatorApp(emulatorApp);
    const temp = path.resolve(os.tmpdir()) + path.sep;
    if (profile && path.resolve(profile).startsWith(temp) && path.basename(profile).startsWith("innera-f1a-browser-")) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
    }
  });

  it("list detail entry, back link and browser back restore the expected view", async () => {
    await open("#clinics");
    await evaluate("document.querySelector('.clinic-details-link').click()");
    await eventually(async () => (await text()).includes("MOCK001"));
    assert.equal(await evaluate("location.hash"), "#clinic/mock-a");
    await click("← 返回院所列表");
    await eventually(() => evaluate("!document.getElementById('clinicListView').hidden"));
    await evaluate("history.back()");
    await eventually(async () => (await text()).includes("MOCK001"));
  });
  it("refresh restores details and preserves name/code fallbacks without assuming active", async () => {
    await open("#clinic/mock-b");
    await evaluate("window.__beforeReload = true");
    await command("Page.reload");
    await eventually(() => evaluate("!window.__beforeReload && !!document.querySelector('.detail-card')"));
    const content = await text();
    assert.match(content, /第二院所/);
    assert.match(content, /未設定/);
    assert.doesNotMatch(content, /啟用中/);
  });
  it("missing clinic and malformed hash have explicit non-editable states", async () => {
    await open("#clinic/missing");
    assert.match(await text(), /找不到此院所/);
    await open("#clinic/%E0%A4%A");
    assert.match(await text(), /連結格式不正確/);
    assert.equal(await evaluate("document.querySelector('.operations-form')"), null);
  });
  it("absent operations are empty; all six fields can save empty values", async () => {
    await open("#clinic/mock-b");
    assert.match(await text(), /尚無本機營運資料/);
    await edit({});
    await submit();
    await eventually(async () => (await text()).includes("已更新本機 mock"));
    const saved = await evaluate("window.InneraClinicDetailsMock.load('mock-b')");
    assert.deepEqual(Object.values(saved.operations), ["", "", "", "", "", ""]);
  });
  it("edit/cancel restores saved values and mock save persists only within this page", async () => {
    await open();
    await edit({ contactName: "取消的姓名" });
    await click("取消");
    assert.doesNotMatch(await text(), /取消的姓名/);
    await edit({ contactName: "新的本機窗口" });
    await submit();
    await eventually(async () => (await text()).includes("已更新本機 mock"));
    await go("mock-b");
    await go("mock-a");
    assert.match(await text(), /新的本機窗口/);
    await open();
    assert.doesNotMatch(await text(), /新的本機窗口/);
  });
  it("validates email, every length limit and fixed clinic type choices", async () => {
    await open();
    await edit({ contactEmail: "bad-email" });
    await submit();
    assert.match(await text(), /有效的合作聯絡 Email/);
    await evaluate("document.getElementById('operation-contactEmail').value = ''");
    for (const [key, limit] of [["contactName",100],["contactTitle",100],["contactEmail",254],["contactPhone",50],["cooperationNotes",3000]]) {
      await evaluate(`document.getElementById('operation-${key}').value = 'x'.repeat(${limit + 1})`);
      await submit();
      assert.match(await text(), new RegExp(`最多 ${limit} 字`));
      await evaluate(`document.getElementById('operation-${key}').value = ''`);
    }
    assert.deepEqual(await evaluate("[...document.getElementById('operation-clinicType').options].map(n=>n.textContent)"),
      ["未分類","精神科診所","其他診所","醫院","心理諮商所","心理治療所","其他"]);
    await evaluate("const option=document.createElement('option'); option.value='tampered'; document.getElementById('operation-clinicType').append(option); document.getElementById('operation-clinicType').value='tampered'");
    await submit();
    assert.match(await text(), /清單中的院所類型/);
  });
  it("unsaved changes prompt on hash navigation; rejecting preserves route and input", async () => {
    await open();
    await edit({ contactName: "未儲存" });
    confirmResult = false;
    const before = dialogs;
    await evaluate("location.hash='#clinic/mock-b'");
    await eventually(() => dialogs > before);
    await eventually(() => evaluate("location.hash === '#clinic/mock-a'"));
    assert.equal(await evaluate("document.getElementById('operation-contactName').value"), "未儲存");
    assert.equal(await evaluate("(() => { const e=new Event('beforeunload',{cancelable:true}); window.dispatchEvent(e); return e.defaultPrevented; })()"), true);
    confirmResult = true;
    await go("mock-b");
    assert.doesNotMatch(await text(), /未儲存/);
  });
  it("rapid switching clears the previous clinic and ignores stale reads", async () => {
    await open();
    await evaluate(`window.__baseLoad=InneraClinicDetailsMock.load;
      InneraClinicDetailsMock.load=async id => { await new Promise(r=>setTimeout(r,id==='mock-b'?800:30)); return window.__baseLoad(id); };
      location.hash='#clinic/mock-b'`);
    await eventually(async () => (await text()).includes("正在讀取"));
    assert.doesNotMatch(await text(), /晴嶼|測試窗口/);
    await go("mock-special");
    await sleep(1000);
    assert.match(await text(), /MOCK003/);
    assert.doesNotMatch(await text(), /第二院所/);
  });
  it("external HTML and special characters remain text in basic and operations views", async () => {
    await open("#clinic/mock-special");
    assert.match(await text(), /<img src=x onerror=alert\(1\)>/);
    assert.equal(await evaluate("document.querySelectorAll('#clinicDetailView img, #clinicList img').length"), 0);
    await edit({ cooperationNotes: '<script>alert("x")</script>\n& <b>文字</b>' });
    await submit();
    await eventually(async () => (await text()).includes("已更新本機 mock"));
    assert.match(await text(), /<script>alert\("x"\)<\/script>/);
    assert.equal(await evaluate("document.querySelectorAll('#clinicDetailView script, #clinicDetailView b').length"), 0);
  });
  it("read failure supports retry; save failure retains edits and prevents duplicate submit", async () => {
    await open("#clinics");
    await evaluate("document.querySelector('.mock-controls input').click(); location.hash='#clinic/mock-a'");
    await eventually(async () => (await text()).includes("無法讀取"));
    await evaluate("document.querySelector('.mock-controls input').click()");
    await click("重新讀取");
    await eventually(async () => (await text()).includes("MOCK001"));
    await edit({ contactName: "保留輸入" });
    await evaluate("document.querySelectorAll('.mock-controls input')[1].click()");
    await submit();
    assert.match(await text(), /正在儲存至本機 mock/);
    assert.equal(await evaluate("document.querySelector('.operations-form button[type=submit]').disabled"), true);
    await eventually(async () => (await text()).includes("儲存失敗"));
    assert.equal(await evaluate("document.getElementById('operation-contactName').value"), "保留輸入");
    await evaluate("document.querySelectorAll('.mock-controls input')[1].click()");
    await submit();
    await eventually(async () => (await text()).includes("已更新本機 mock"));
  });
  it("existing status/resend buttons keep their independent handlers", async () => {
    await open("#clinics");
    await evaluate(`window.__calls=[];
      firebase.app=()=>({functions:()=>({httpsCallable:name=>async input=>{
        window.__calls.push({name,input});
        return {data:{success:true,inviteId:'fake',token:'fake',adminEmail:'fake@example.test'}};
      }})});
      firebase.auth=()=>({sendSignInLinkToEmail:async()=>{}});
      window.INNERA_ADMIN_ENV={staffActivationUrl:'https://example.test/activation'};
      document.querySelector('.clinic-status-button').click()`);
    await eventually(() => evaluate("window.__calls.length === 1"));
    assert.equal(await evaluate("__calls[0].name"), "setClinicStatus");
    await eventually(() => evaluate("!document.querySelector('.clinic-status-button').disabled"));
    await evaluate("document.querySelector('.clinic-resend-invite-button').click()");
    await eventually(() => evaluate("__calls.length === 2"));
    assert.equal(await evaluate("__calls[1].name"), "resendInitialAdminInvite");
    assert.equal(await evaluate("document.getElementById('clinicDetailView').hidden"), true);
  });
  for (const demo of [true, false]) {
    it(`${demo ? "Demo" : "Production"} callable load/save uses the correct project, region and revision`, async () => {
      const hook = await callableHook(demo);
      try {
        await open("#clinic/a", demo ? "dashboard.demo.html" : "dashboard.html");
        assert.match(await text(), /尚無營運資料/);
        assert.doesNotMatch(await text(), /尚未接入|本機 UI 模擬/);
        await edit({ contactName: "Callable contact" });
        await submit();
        await eventually(async () => (await text()).includes("營運資料已儲存"));
        assert.match(await text(), /版本：1/);
        assert.doesNotMatch(await text(), /最後修改時間：未提供/);
        await edit({ contactName: "Second" });
        await submit();
        await eventually(async () => (await text()).includes("版本：2"));
        const calls = await evaluate("__calls");
        assert.deepEqual(calls.map(c => c.name), ["getClinicDetails","updateClinicOperations","updateClinicOperations"]);
        assert.deepEqual(calls.slice(1).map(c => c.input.expectedRevision), [0,1]);
        assert.ok(calls.every(c => c.region === "asia-east1" && c.projectId === (demo ? "innera-demo" : "moodsogood-9e45b")));
        await edit({ contactName: "blocked" });
        await evaluate("__app.options.projectId='wrong-project'");
        await submit();
        assert.match(await text(), /環境設定不一致/);
        assert.equal(await evaluate("__calls.length"), 3);
      } finally { await removeHook(hook); }
    });
  }
  it("callable errors never render empty data or fake save success", async () => {
    const hook = await callableHook();
    try {
      await open("#clinic/missing");
      assert.match(await text(), /找不到此院所/);
      assert.equal(await evaluate("document.querySelector('.operations-form')"), null);
      for (const [code, message] of [["permission-denied","沒有存取"],["unauthenticated","登入已失效"],["internal","無法讀取"]]) {
        await evaluate(`__failure={code:'functions/${code}'}; location.hash='#clinic/${code}'`);
        await eventually(async () => (await text()).includes(message));
        assert.equal(await evaluate("document.querySelector('.operations-form')"), null);
      }
      await evaluate("__failure=null; location.hash='#clinic/a'");
      await eventually(async () => (await text()).includes("CALL01"));
      await edit({ contactName: "preserved" });
      await evaluate("__failure={code:'functions/internal',message:'SECRET'}");
      await submit();
      await eventually(async () => (await text()).includes("無法確認儲存結果"));
      assert.doesNotMatch(await text(), /已儲存。|SECRET/);
      assert.equal(await evaluate("document.getElementById('operation-contactName').value"), "preserved");
      assert.equal(await evaluate("document.querySelector('.operations-form button[type=submit]').disabled"), true);
    } finally { await removeHook(hook); }
  });
  it("conflict preserves input and revision; reload requires consent and failures preserve input", async () => {
    const hook = await callableHook();
    try {
      await open("#clinic/a");
      await edit({ contactName: "draft" });
      await evaluate("__failure={code:'functions/failed-precondition',details:{reason:'revision-conflict'}}");
      await submit();
      await eventually(async () => (await text()).includes("資料已被其他人修改"));
      assert.equal(await evaluate("document.getElementById('operation-contactName').value"), "draft");
      assert.match(await text(), /版本：0/);
      await submit();
      assert.equal(await evaluate("__calls.length"), 2);
      confirmResult = false;
      await click("重新載入最新資料");
      assert.equal(await evaluate("__calls.length"), 2);
      confirmResult = true;
      await evaluate("__failure={code:'functions/internal'}");
      await click("重新載入最新資料");
      await eventually(async () => (await text()).includes("原輸入仍保留"));
      assert.equal(await evaluate("document.getElementById('operation-contactName').value"), "draft");
      await evaluate("__failure=null; __stored={...__empty(),contactName:'Someone else'}; __revision=4");
      await click("重新載入最新資料");
      await eventually(async () => (await text()).includes("已載入最新資料"));
      assert.match(await text(), /Someone else|版本：4/);
      await edit({ contactName: "merged" });
      await submit();
      await eventually(async () => (await text()).includes("版本：5"));
    } finally { await removeHook(hook); }
  });
  it("pending callable save submits once and cannot paint a different clinic", async () => {
    const hook = await callableHook();
    try {
      await open("#clinic/a");
      await edit({ contactName: "old draft" });
      await evaluate("__delay=500");
      await submit();
      await submit();
      assert.equal(await evaluate("__calls.filter(c=>c.name==='updateClinicOperations').length"), 1);
      await evaluate("location.hash='#clinic/b'");
      await eventually(async () => (await text()).includes("正在讀取"));
      assert.doesNotMatch(await text(), /old draft|Callable a/);
      await eventually(async () => (await text()).includes("Callable b"));
      assert.doesNotMatch(await text(), /營運資料已儲存/);
    } finally { await removeHook(hook); }
  });
  it("browser back cancellation retains callable draft, acceptance returns to list", async () => {
    const hook = await callableHook();
    try {
      await open("#clinics");
      await evaluate("location.hash='#clinic/a'");
      await eventually(async () => (await text()).includes("CALL01"));
      await edit({ contactName: "unsaved" });
      confirmResult = false;
      const count = dialogs;
      await evaluate("history.back()");
      await eventually(() => dialogs > count);
      await eventually(() => evaluate("location.hash==='#clinic/a'"));
      assert.equal(await evaluate("document.getElementById('operation-contactName').value"), "unsaved");
      confirmResult = true;
      await click("← 返回院所列表");
      await eventually(() => evaluate("!document.getElementById('clinicListView').hidden"));
    } finally { await removeHook(hook); }
  });
  it("malformed successful callable response is not treated as empty or saved", async () => {
    const hook = await callableHook();
    try {
      await open("#clinic/a");
      await edit({ contactName: "draft" });
      await evaluate("__app.functions=()=>({httpsCallable:()=>async()=>({data:{}})})");
      await submit();
      await eventually(async () => (await text()).includes("無法確認儲存結果"));
      assert.equal(await evaluate("document.getElementById('operation-contactName').value"), "draft");
      await evaluate("location.hash='#clinic/b'");
      await eventually(async () => (await text()).includes("無法讀取"));
      assert.equal(await evaluate("document.querySelector('.operations-form')"), null);
    } finally { await removeHook(hook); }
  });
  it("UI → callable handler → local Firestore saves, reads back and preserves clinic", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
    const hook = await callableHook(true, true);
    try {
      await open("#clinic/f1c");
      assert.match(await text(), /Local Emulator Clinic|尚無營運資料/);
      await edit({ contactName: "Emulator contact" });
      await submit();
      await eventually(async () => (await text()).includes("營運資料已儲存"));
      const stored = (await emulatorDb.doc("clinicOperations/f1c").get()).data();
      assert.equal(stored.revision, 1); assert.equal(stored.contactName, "Emulator contact");
      await open("#clinic/f1c");
      assert.match(await text(), /Emulator contact/);
      assert.doesNotMatch(await text(), /最後修改時間：未提供|最後修改時間：尚無紀錄/);
      // Use the browser's locale data: Node and Chromium can differ in zh-TW
      // noon labels/spacing despite representing the same persisted instant.
      const expectedTime = await evaluate(`new Intl.DateTimeFormat('zh-TW', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(${stored.updatedAt.toMillis()}))`);
      assert.ok((await text()).includes(expectedTime));
      assert.deepEqual((await emulatorDb.doc("clinics/f1c").get()).data(),
        { name: "Local Emulator Clinic", status: "inactive", phone: "unchanged" });
    } finally { await removeHook(hook); }
  });
  const integration = { skip: !process.env.FIRESTORE_EMULATOR_HOST };
  const emulatorRequest = data => ({ auth: { uid: "platform" }, data });
  async function resetTrialClinic(id) {
    loseTrialResponse = false;
    // Isolate repeat runs in the already-guarded synthetic Emulator project.
    const logs = await emulatorDb.collection("auditLogs").where("targetClinicId", "==", id).get();
    const batch = emulatorDb.batch();
    for (const log of logs.docs) batch.delete(log.ref);
    await batch.commit();
    await emulatorDb.doc(`clinics/${id}`).set({ name: `Local ${id}`, status: "active", active: true });
    await emulatorDb.doc(`clinicOperations/${id}`).delete();
  }
  it("F2-D UI → actual handler → Emulator: empty read, set/reschedule/close and bidirectional shared revision", integration, async () => {
    const hook = await callableHook(true, true);
    const id = "f2d-flow";
    try {
      await resetTrialClinic(id); await open(`#clinic/${id}`);
      assert.equal((await emulatorDb.doc(`clinicOperations/${id}`).get()).exists, false);
      assert.match(await trialText(), /尚未設定/);
      await click("設定開始日");
      const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0,10);
      await evaluate(`document.getElementById('trial-startDate').value=${JSON.stringify(future)}`);
      await trialSubmit(); await eventually(async () => (await trialText()).includes("試用資料已儲存"));
      assert.equal((await emulatorDb.doc(`clinicOperations/${id}`).get()).data().revision, 1);
      await edit({ contactName: "F2-D persisted F1" }); await submit();
      await eventually(async () => (await text()).includes("營運資料已儲存"));
      assert.match(await trialText(), /版本：2/);
      await click("調整開始日");
      await evaluate(`document.getElementById('trial-startDate').value=${JSON.stringify(new Date(Date.now()+11*86400000).toISOString().slice(0,10))}`);
      await trialSubmit(); await eventually(async () => (await trialText()).includes("試用資料已儲存"));
      await click("轉正式"); await evaluate("document.getElementById('trial-reason').value='Real emulator conversion'");
      await trialSubmit(); await eventually(async () => (await trialText()).includes("已轉正式合作"));
      assert.deepEqual(await evaluate("__calls.filter(c=>c.name.startsWith('update')).map(c=>c.input.expectedRevision)"), [0,1,2,3]);
      const stored = (await emulatorDb.doc(`clinicOperations/${id}`).get()).data();
      assert.equal(stored.revision, 4); assert.equal(stored.contactName, "F2-D persisted F1");
      assert.equal(stored.trial.resolution, "converted");
      await open(`#clinic/${id}`);
      assert.match(await text(), /F2-D persisted F1/); assert.match(await trialText(), /已轉正式合作|Real emulator conversion/);
      assert.equal((await emulatorDb.doc(`clinics/${id}`).get()).data().status, "active");
    } finally { await removeHook(hook); }
  });
  it("F2-D UI: real revision conflict preserves draft and confirmed reload matches database", integration, async () => {
    const hook = await callableHook(true, true), id = "f2d-conflict";
    try {
      await resetTrialClinic(id); await open(`#clinic/${id}`); await click("設定開始日");
      const future = new Date(Date.now()+10*86400000).toISOString().slice(0,10);
      await evaluate(`document.getElementById('trial-startDate').value=${JSON.stringify(future)}`);
      await emulatorLoaded.functions.updateClinicTrial.run(emulatorRequest({ clinicId: id, expectedRevision: 0, action: "setStart", startDate: future }));
      await trialSubmit(); await eventually(async () => (await trialText()).includes("資料已被其他人修改"));
      assert.equal(await evaluate("document.getElementById('trial-startDate').value"), future);
      await trialSubmit(); assert.equal(await evaluate("__calls.filter(c=>c.name==='updateClinicTrial').length"), 1);
      await click("重新載入最新資料", ".trial-card");
      await eventually(async () => (await text()).includes("已載入最新資料"));
      assert.match(await trialText(), /版本：1/);
      assert.ok((await trialText()).includes((await emulatorDb.doc(`clinicOperations/${id}`).get()).data().trial.startDate));
    } finally { await removeHook(hook); }
  });
  it("F2-D UI: actual commit with lost response is not resent; reload reveals persisted termination", integration, async () => {
    const hook = await callableHook(true, true), id = "f2d-lost";
    try {
      await resetTrialClinic(id);
      const future = new Date(Date.now()+10*86400000).toISOString().slice(0,10);
      await emulatorLoaded.functions.updateClinicTrial.run(emulatorRequest({ clinicId: id, expectedRevision: 0, action: "setStart", startDate: future }));
      await open(`#clinic/${id}`); await click("終止");
      await evaluate("document.getElementById('trial-reason').value='Persisted but response lost'");
      loseTrialResponse = true; await trialSubmit();
      await eventually(async () => (await trialText()).includes("無法確認儲存結果"));
      assert.equal((await emulatorDb.doc(`clinicOperations/${id}`).get()).data().trial.resolution, "terminated");
      assert.equal(await evaluate("document.getElementById('trial-reason').value"), "Persisted but response lost");
      await trialSubmit();
      assert.equal(await evaluate("__calls.filter(c=>c.name==='updateClinicTrial').length"), 1);
      await click("重新載入最新資料", ".trial-card");
      await eventually(async () => (await trialText()).includes("已終止"));
      assert.equal((await emulatorDb.doc(`clinicOperations/${id}`).get()).data().revision, 2);
      const logs = await emulatorDb.collection("auditLogs").where("targetClinicId", "==", id).get();
      assert.equal(logs.size, 2);
    } finally { loseTrialResponse = false; await removeHook(hook); }
  });
  it("F2-D UI: all six actual handler states, dates and remaining days render from Emulator fixtures", integration, async () => {
    const hook = await callableHook(true, true), id = "f2d-states";
    try {
      for (const [status, label] of Object.entries({ not_configured:"尚未設定",scheduled:"未開始",active:"試用中",expired:"已到期",converted:"已轉正式合作",terminated:"已終止" })) {
        await resetTrialClinic(id);
        if (status !== "not_configured") {
          const future = new Date(Date.now()+10*86400000).toISOString().slice(0,10);
          await emulatorLoaded.functions.updateClinicTrial.run(emulatorRequest({ clinicId:id,expectedRevision:0,action:"setStart",startDate:future }));
          if (["active","expired"].includes(status)) await emulatorDb.doc(`clinicOperations/${id}`).update({
            "trial.startDate":new Date(Date.now()-(status==="active"?1:90)*86400000).toISOString().slice(0,10)
          }); // Synthetic historical fixture only; not an application API.
          if (["converted","terminated"].includes(status)) await emulatorLoaded.functions.updateClinicTrial.run(emulatorRequest({
            clinicId:id,expectedRevision:1,action:status==="converted"?"convert":"terminate",reason:"Synthetic closure"
          }));
        }
        const result = await emulatorLoaded.functions.getClinicDetails.run(emulatorRequest({clinicId:id}));
        assert.equal(result.trialComputed.status,status);
        await open(`#clinic/${id}`); const content=await trialText(); assert.ok(content.includes(label));
        if (status==="not_configured") assert.equal((await emulatorDb.doc(`clinicOperations/${id}`).get()).exists,false);
        else {
          assert.ok(content.includes(result.trial.startDate)); assert.ok(content.includes(result.trialComputed.lastTrialDate));
          if (result.trialComputed.remainingDays!==null) assert.ok(content.includes(`${result.trialComputed.remainingDays} 天`));
          const expected=await evaluate(`new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(${result.trialComputed.expiresAt.seconds*1000}))`);
          assert.ok(content.includes(expected));
        }
      }
    } finally { await removeHook(hook); }
  });
  it("Demo and Production share the same detail structure/scripts, without preview injection", async () => {
    const prod = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
    const demo = fs.readFileSync(path.join(root, "dashboard.demo.html"), "utf8");
    assert.equal(prod.replace("firebase-config-prod.js","firebase-config-demo.js"), demo);
    assert.ok(prod.includes("admin-clinic-details.js"));
    assert.doesNotMatch(prod, /clinic-details-mock/);
    assert.doesNotMatch(previewHtml(prod), /gstatic|firebase-config|admin-core/);
    await open("#clinic/mock-a", "dashboard.html");
    assert.match(await text(), /MOCK001/);
    const response = await fetch(`${origin}/functions/index.js`);
    assert.equal(response.status, 404);
    // Chrome's native date input can emit a built-in data: SVG calendar icon.
    // Embedded data is not a network request; external origins remain forbidden.
    const external = requests.filter(url => !url.startsWith(origin) && url !== "about:blank" && !url.startsWith("data:"));
    assert.deepEqual(external, [], "Preview must never request cloud assets or data");
  });
  const trialText = () => evaluate("document.querySelector('.trial-card').innerText");
  const trialSubmit = () => evaluate("document.querySelector('.trial-form').requestSubmit()");
  async function trialScenario(status) {
    await open();
    await evaluate(`InneraClinicDetailsMock.settings.delay=10; InneraClinicDetailsMock.seedTrial(${JSON.stringify(status)});
      dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))`);
    await eventually(async () => (await text()).includes("已載入最新資料"));
  }
  it("F2: all six states render backend dates/days and only legal actions; empty is not initialized", async () => {
    for (const [status, label, buttons] of [
      ["not_configured","尚未設定",["設定開始日"]], ["scheduled","未開始",["調整開始日","轉正式","終止"]],
      ["active","試用中",["轉正式","終止"]], ["expired","已到期",["轉正式","終止"]],
      ["converted","已轉正式合作",[]], ["terminated","已終止",[]]
    ]) {
      await trialScenario(status);
      const content = await trialText();
      assert.ok(content.includes(label));
      assert.match(content, /12 週／84 天/);
      assert.match(content, /試用到期或終止不會自動停用院所或中斷資料存取。/);
      assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-trial-action]')].map(n=>n.textContent)"), buttons);
      const result = await evaluate("InneraClinicDetailsMock.load('mock-a')");
      if (status === "not_configured") { assert.equal(result.trial, null); assert.match(content, /尚未設定試用/); }
      else {
        assert.ok(content.includes(result.trial.startDate));
        assert.ok(content.includes(result.trialComputed.lastTrialDate));
        if (result.trialComputed.remainingDays !== null) assert.ok(content.includes(result.trialComputed.remainingDays + " 天"));
        const expected = await evaluate(`new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(${result.trialComputed.expiresAt.seconds * 1000}))`);
        assert.ok(content.includes(expected));
      }
      assert.equal(content.includes("結案原因"), ["converted","terminated"].includes(status));
      assert.equal(await evaluate("InneraClinicDetailsMock.calls.filter(c=>c.name==='updateClinicTrial').length"), 0);
    }
  });
  it("F2: set start, reschedule, confirm cancellation and bidirectional shared revision", async () => {
    await trialScenario("not_configured");
    const future = await evaluate("new Date(Date.now()+10*86400000).toISOString().slice(0,10)");
    await click("設定開始日");
    await evaluate(`document.getElementById('trial-startDate').value=${JSON.stringify(future)}`);
    confirmResult = false; await trialSubmit();
    assert.equal(await evaluate("InneraClinicDetailsMock.calls.filter(c=>c.name==='updateClinicTrial').length"), 0);
    confirmResult = true; await trialSubmit();
    await eventually(async () => (await trialText()).includes("試用資料已更新"));
    assert.match(await text(), /版本：2/);
    await edit({ contactName: "F2 shared revision" }); await submit();
    await eventually(async () => (await text()).includes("已更新本機 mock"));
    assert.match(await trialText(), /版本：3/);
    await click("調整開始日");
    await evaluate("document.getElementById('trial-startDate').value=new Date(Date.now()+11*86400000).toISOString().slice(0,10)");
    await trialSubmit(); await eventually(async () => (await trialText()).includes("試用資料已更新"));
    assert.deepEqual(await evaluate("InneraClinicDetailsMock.calls.filter(c=>c.name.startsWith('update')).map(c=>c.expectedRevision)"), [1,2,3]);
    assert.match(await text(), /F2 shared revision/);
    assert.equal(await evaluate("[...document.querySelectorAll('.detail-card')].filter(n=>n.innerText.includes('版本：4')).length"), 2);
  });
  it("F2: validates date/reason, closes with trimmed 500 UTF-16 units, preserves text safely", async () => {
    await trialScenario("not_configured"); await click("設定開始日");
    for (const value of ["", "2026-02-30", "2000-01-01"]) {
      await evaluate(`document.getElementById('trial-startDate').value=${JSON.stringify(value)}`);
      await trialSubmit(); assert.match(await trialText(), /有效開始日期/);
    }
    await click("取消", ".trial-card");
    for (const action of ["轉正式", "終止"]) {
      await trialScenario("active"); await click(action);
      for (const value of ["  ", "x".repeat(501), "😀".repeat(251)]) {
        await evaluate(`document.getElementById('trial-reason').value=${JSON.stringify(value)}`);
        await trialSubmit(); assert.match(await trialText(), /1～500 字元/);
      }
      await evaluate("document.getElementById('trial-reason').value='  '+ '<b>'.padEnd(500,'x') +'  '");
      await trialSubmit(); await eventually(async () => (await trialText()).includes("試用資料已更新"));
      const saved = await evaluate("InneraClinicDetailsMock.load('mock-a')");
      assert.equal(saved.trial.resolutionReason.length, 500);
      assert.equal(saved.trial.resolution, action === "轉正式" ? "converted" : "terminated");
      assert.equal(await evaluate("document.querySelectorAll('.trial-card b').length"), 0);
      assert.equal(await evaluate("document.querySelectorAll('[data-trial-action]').length"), 0);
    }
  });
  it("F2: unchanged scheduled date rejected; pending write disables both cards and sends once", async () => {
    await trialScenario("scheduled"); await click("調整開始日"); await trialSubmit();
    assert.match(await trialText(), /未變更/);
    await evaluate("InneraClinicDetailsMock.settings.delay=500; document.getElementById('trial-startDate').value=new Date(Date.now()+10*86400000).toISOString().slice(0,10)");
    await trialSubmit(); await trialSubmit();
    assert.equal(await evaluate("InneraClinicDetailsMock.calls.filter(c=>c.name==='updateClinicTrial').length"), 1);
    assert.equal(await evaluate("[...document.querySelectorAll('.detail-card button')].filter(n=>!n.disabled).length"), 0);
    await eventually(async () => (await trialText()).includes("試用資料已更新"));
  });
  it("F2: conflict retains draft, blocks both cards; rejected/failed reload does not discard it", async () => {
    await trialScenario("active"); await click("終止");
    await evaluate("document.getElementById('trial-reason').value='preserve trial draft'; InneraClinicDetailsMock.advanceRevision()");
    await trialSubmit(); await eventually(async () => (await trialText()).includes("資料已被其他人修改"));
    assert.equal(await evaluate("document.getElementById('trial-reason').value"), "preserve trial draft");
    await trialSubmit();
    assert.equal(await evaluate("InneraClinicDetailsMock.calls.filter(c=>c.name==='updateClinicTrial').length"), 1);
    const count = await evaluate("InneraClinicDetailsMock.calls.length");
    confirmResult = false; await click("重新載入最新資料", ".trial-card");
    assert.equal(await evaluate("InneraClinicDetailsMock.calls.length"), count);
    confirmResult = true;
    await evaluate("InneraClinicDetailsMock.settings.readFailure=true");
    await click("重新載入最新資料", ".trial-card");
    await eventually(async () => (await text()).includes("原輸入仍保留"));
    assert.equal(await evaluate("document.getElementById('trial-reason').value"), "preserve trial draft");
    await evaluate("InneraClinicDetailsMock.settings.readFailure=false");
    await click("重新載入最新資料", ".trial-card");
    await eventually(async () => (await text()).includes("已載入最新資料"));
    assert.match(await trialText(), /版本：2/);
    await click("終止"); await evaluate("document.getElementById('trial-reason').value='reviewed'");
    await trialSubmit(); await eventually(async () => (await trialText()).includes("試用資料已更新"));
    assert.equal(await evaluate("InneraClinicDetailsMock.calls.filter(c=>c.name==='updateClinicTrial').at(-1).expectedRevision"), 2);
  });
  it("F2: committed response loss is uncertain, not retried, and only confirmed reload resolves it", async () => {
    await trialScenario("active"); await click("轉正式");
    await evaluate("document.getElementById('trial-reason').value='lost response'; InneraClinicDetailsMock.settings.lostResponse=true");
    await trialSubmit(); await eventually(async () => (await trialText()).includes("無法確認儲存結果"));
    assert.doesNotMatch(await trialText(), /已轉正式合作/);
    const count = await evaluate("InneraClinicDetailsMock.calls.length");
    await evaluate("dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");
    await trialSubmit();
    assert.equal(await evaluate("InneraClinicDetailsMock.calls.length"), count);
    assert.equal(await evaluate("document.getElementById('trial-reason').value"), "lost response");
    await click("重新載入最新資料", ".trial-card");
    await eventually(async () => (await trialText()).includes("已轉正式合作"));
    assert.equal(await evaluate("InneraClinicDetailsMock.calls.filter(c=>c.name==='updateClinicTrial').length"), 1);
  });
  it("F2: restore refresh preserves drafts, rejects stale revision, and coalesces in-flight refreshes", async () => {
    await trialScenario("active");
    await evaluate("window.__realLoad=InneraClinicDetailsMock.load; InneraClinicDetailsMock.load=async id=>({...await __realLoad(id),revision:0})");
    await evaluate("dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");
    await eventually(async () => (await text()).includes("原輸入仍保留"));
    assert.match(await trialText(), /版本：1/);
    await evaluate("InneraClinicDetailsMock.load=__realLoad");
    await click("重新載入最新資料", ".trial-card");
    await eventually(async () => (await text()).includes("已載入最新資料"));
    await edit({ contactName: "restore draft" });
    const count = await evaluate("InneraClinicDetailsMock.calls.length");
    await evaluate("document.dispatchEvent(new Event('visibilitychange'))");
    assert.equal(await evaluate("document.getElementById('operation-contactName').value"), "restore draft");
    assert.equal(await evaluate("InneraClinicDetailsMock.calls.length"), count);
    await click("重新載入最新資料", ".trial-card");
    await eventually(async () => (await text()).includes("已載入最新資料"));
    const reads = await evaluate("InneraClinicDetailsMock.calls.length");
    await evaluate("InneraClinicDetailsMock.settings.delay=80; for(let i=0;i<5;i++)dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");
    await eventually(() => evaluate(`InneraClinicDetailsMock.calls.length === ${reads + 2}`));
    await sleep(200);
    assert.equal(await evaluate("InneraClinicDetailsMock.calls.length"), reads + 2);
  });
  it("F2: single midnight timer refreshes backend state without local status inference", async () => {
    const hook = await command("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__now=Date.parse('2026-10-27T15:59:59Z');
      const RealDate=Date; window.Date=class extends RealDate {static now(){return window.__now;}};
      const realTimeout=setTimeout; window.__midnight=[];
      window.setTimeout=(fn,ms,...args)=>{if(String(fn).includes('requestRefresh')){window.__midnight.push({fn,ms});return 123456;}return realTimeout(fn,ms,...args);};
    ` });
    try {
      await trialScenario("scheduled");
      assert.equal(await evaluate("__midnight.at(-1).ms"), 1050);
      const before = await evaluate("InneraClinicDetailsMock.calls.length");
      await evaluate("window.__now=Date.parse('2026-10-29T16:00:00Z'); window.__midnight.at(-1).fn()");
      await eventually(async () => (await trialText()).includes("試用中"));
      assert.equal(await evaluate("InneraClinicDetailsMock.calls.length"), before + 1);
      assert.equal(await evaluate("__midnight.at(-1).ms"), 86400050);
    } finally { await removeHook(hook); }
  });
  it("F2: callable adapter sends exact F2-B payload, checks environment and fails closed on malformed response", async () => {
    const hook = await callableHook();
    try {
      await open();
      await evaluate("__trialBridge=true; InneraClinicDetailsMock.settings.delay=10; dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");
      await eventually(async () => (await text()).includes("已載入最新資料"));
      await click("設定開始日");
      const date = await evaluate("new Date(Date.now()+10*86400000).toISOString().slice(0,10)");
      await evaluate(`document.getElementById('trial-startDate').value=${JSON.stringify(date)}`);
      await trialSubmit(); await eventually(async () => (await trialText()).includes("試用資料已儲存"));
      const call = await evaluate("__calls.find(c=>c.name==='updateClinicTrial')");
      assert.deepEqual(call.input, { clinicId: "mock-a", action: "setStart", startDate: date, expectedRevision: 1 });
      assert.equal(call.region, "asia-east1"); assert.equal(call.projectId, "innera-demo");
      await click("終止"); await evaluate("document.getElementById('trial-reason').value='malformed'; __app.functions=()=>({httpsCallable:()=>async()=>({data:{}})})");
      await trialSubmit(); await eventually(async () => (await trialText()).includes("無法確認儲存結果"));
      assert.equal(await evaluate("document.getElementById('trial-reason').value"), "malformed");
    } finally { await removeHook(hook); }
  });
  it("F2: trial draft navigation guard and late response cannot paint another clinic", async () => {
    await trialScenario("active"); await click("終止");
    await evaluate("document.getElementById('trial-reason').value='pending trial'");
    confirmResult = false;
    const before = dialogs; await evaluate("location.hash='#clinic/mock-b'");
    await eventually(() => dialogs > before);
    await eventually(() => evaluate("location.hash==='#clinic/mock-a'"));
    assert.equal(await evaluate("document.getElementById('trial-reason').value"), "pending trial");
    confirmResult = true;
    await evaluate("InneraClinicDetailsMock.settings.delay=500"); await trialSubmit();
    await go("mock-b");
    assert.match(await trialText(), /尚未設定/);
    assert.doesNotMatch(await trialText(), /pending trial|已終止/);
  });
  it("F2: desktop/phone card and reason form have no overflow", async () => {
    await trialScenario("active"); await click("終止");
    for (const width of [1280,390]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
      if (process.env.INNERA_TEST_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.INNERA_TEST_SCREENSHOT_DIR, { recursive: true });
        await evaluate("document.querySelector('.trial-card').scrollIntoView()");
        const clip = await evaluate("(()=>{const r=document.querySelector('.trial-card').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()");
        const image = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip });
        fs.writeFileSync(path.join(process.env.INNERA_TEST_SCREENSHOT_DIR, `f2c-${width}.png`), Buffer.from(image.data,"base64"));
      }
    }
    await command("Emulation.clearDeviceMetricsOverride");
  });
  it("F2-F release artifact ignores preview marker and uses callable contracts for F1/F2", async () => {
    const hook = await callableHook();
    const marker = await command("Page.addScriptToEvaluateOnNewDocument", { source: `
      document.addEventListener('DOMContentLoaded',()=>{
        document.body.dataset.inneraPreview='mock';
      });
    ` });
    previewOptions.releaseArtifact = true;
    try {
      await open();
      assert.equal(await evaluate("__calls[0].name"), "getClinicDetails");
      assert.doesNotMatch(await trialText(), /mock/);
      await edit({contactName:"Release F1"}); await submit();
      await eventually(async () => (await text()).includes("營運資料已儲存"));
      assert.equal(await evaluate("__calls.at(-1).name"), "updateClinicOperations");
      await evaluate("__trialBridge=true; dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");
      await eventually(async () => (await text()).includes("已載入最新資料"));
      await click("設定開始日");
      await evaluate("document.getElementById('trial-startDate').value=new Date(Date.now()+10*86400000).toISOString().slice(0,10)");
      await trialSubmit();
      await eventually(async () => (await trialText()).includes("試用資料已儲存"));
      assert.equal(await evaluate("__calls.at(-1).name"), "updateClinicTrial");
      assert.match(await trialText(), /未開始/);
      assert.doesNotMatch(await text(), /本機 mock|本機 UI 模擬/);
    } finally { previewOptions.releaseArtifact = false; await removeHook(marker); await removeHook(hook); }
  });
  it("desktop and phone layouts have no horizontal overflow and use two/one columns", async () => {
    await open();
    for (const [width, columns] of [[1280,2],[390,1]]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await edit({});
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.detail-form-grid')).gridTemplateColumns.split(' ').length"), columns);
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
      if (process.env.INNERA_TEST_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.INNERA_TEST_SCREENSHOT_DIR, { recursive: true });
        const metrics = await command("Page.getLayoutMetrics");
        const image = await command("Page.captureScreenshot", {
          format: "png", captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 }
        });
        fs.writeFileSync(path.join(process.env.INNERA_TEST_SCREENSHOT_DIR, `f1a-${width}.png`), Buffer.from(image.data, "base64"));
      }
      await click("取消");
    }
    await command("Emulation.clearDeviceMetricsOverride");
  });
});
