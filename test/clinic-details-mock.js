/* Local preview only: the server removes every Firebase/config/auth script. */
(function () {
  "use strict";
  const clinics = {
    "mock-a": { name: "晴嶼身心診所（虛構）", clinicCode: "MOCK001", status: "active", phone: "02-0000-0000", address: "測試市示範路 1 號", defaultDepartment: "精神科", createdAt: "2026-10-01T02:00:00Z", initialAdminInviteId: "mock-invite" },
    "mock-b": { clinicName: "第二院所（虛構）", code: "MOCK002", address: "此院所沒有營運資料或狀態欄位" },
    "mock-special": { name: '<img src=x onerror=alert(1)> & "特殊字元"', clinicCode: "MOCK003", status: "inactive" }
  };
  const records = new Map();
  records.set("mock-a", { revision: 1, operations: {
    contactName: "測試窗口", contactTitle: "行政部門", contactEmail: "contact@example.test",
    contactPhone: "+886 2 0000 0000 #123", clinicType: "psychiatry_clinic",
    cooperationNotes: "虛構合作備註，僅供本機 UI 預覽。\n不含真實患者或醫療資料。"
  } });
  const settings = { delay: 350, readFailure: false, saveFailure: false };
  const calls = [];
  const now = () => settings.now ?? Date.now();
  const stamp = () => ({ seconds: Math.floor(now() / 1000), nanoseconds: 0 });
  const day = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
  const empty = () => Object.fromEntries(["contactName", "contactTitle", "contactEmail", "contactPhone", "clinicType", "cooperationNotes"].map(k => [k, ""]));
  // Fake backend only. Production UI never calculates a trial status.
  function trialView(trial) {
    if (!trial) return { trial: null, evaluatedAt: stamp(), trialComputed: {
      status: "not_configured", remainingDays: null, expiresAt: null, lastTrialDate: null, endDateExclusive: null
    } };
    const end = Date.parse(trial.startDate + "T00:00:00+08:00") + 84 * 86400000;
    const status = trial.resolution || (day(now()) < trial.startDate ? "scheduled" : now() < end ? "active" : "expired");
    return { trial: structuredClone(trial), evaluatedAt: stamp(), trialComputed: {
      status, endDateExclusive: day(end), lastTrialDate: day(end - 86400000),
      expiresAt: { seconds: end / 1000, nanoseconds: 0 },
      remainingDays: status === "active" ? Math.round((end - Date.parse(day(now()) + "T00:00:00+08:00")) / 86400000) : status === "expired" ? 0 : null
    } };
  }
  const wait = () => new Promise(resolve => setTimeout(resolve, settings.delay));
  window.InneraClinicDetailsMock = {
    mode: "mock",
    settings, calls,
    seedTrial(status, id = "mock-a") {
      const record = records.get(id) || { operations: empty(), revision: 1 };
      if (status === "not_configured") delete record.trial;
      else record.trial = {
        schemaVersion: 1, startDate: day(now() + (status === "scheduled" ? 2 : status === "expired" ? -90 : -1) * 86400000),
        durationDays: 84, timeZone: "Asia/Taipei", resolution: ["converted", "terminated"].includes(status) ? status : null,
        resolvedAt: ["converted", "terminated"].includes(status) ? stamp() : null, resolvedBy: null,
        resolutionReason: ["converted", "terminated"].includes(status) ? "本機結案原因" : null,
        updatedAt: stamp(), updatedBy: "mock"
      };
      records.set(id, record);
    },
    advanceRevision(id = "mock-a") { records.get(id).revision++; },
    async load(id) {
      calls.push({ name: "getClinicDetails", id });
      await wait();
      if (settings.readFailure) throw new Error("mock-read");
      if (!clinics[id]) return null;
      const record = records.get(id) || { operations: null, revision: 0 };
      return structuredClone({ clinic: { ...clinics[id] }, ...record, ...trialView(record.trial) });
    },
    async save(id, operations, expectedRevision) {
      calls.push({ name: "updateClinicOperations", id, expectedRevision });
      await wait();
      if (settings.saveFailure) throw new Error("mock-save");
      if (!clinics[id] || (records.get(id)?.revision || 0) !== expectedRevision) throw { code: "functions/failed-precondition", details: { reason: "revision-conflict" } };
      const result = { ...records.get(id), operations: { ...operations }, revision: expectedRevision + 1, updatedAt: stamp() };
      records.set(id, result);
      return structuredClone({ operations: result.operations, revision: result.revision, updatedAt: result.updatedAt });
    },
    async saveTrial(id, action, payload, expectedRevision) {
      calls.push({ name: "updateClinicTrial", id, action, payload: { ...payload }, expectedRevision });
      await wait();
      if (settings.trialFailure) throw structuredClone(settings.trialFailure);
      const record = records.get(id) || { operations: empty(), revision: 0 };
      const fail = reason => { throw { code: "functions/failed-precondition", details: { reason } }; };
      if (record.revision !== expectedRevision) fail("revision-conflict");
      const state = trialView(record.trial).trialComputed.status;
      if (["converted", "terminated"].includes(state)) fail("trial-terminal");
      if (action === "setStart") {
        if (!["not_configured", "scheduled"].includes(state)) fail("trial-already-started");
        if (payload.startDate < day(now())) fail("trial-start-in-past");
        if (payload.startDate === record.trial?.startDate) fail("trial-no-change");
        record.trial = { schemaVersion: 1, startDate: payload.startDate, durationDays: 84, timeZone: "Asia/Taipei",
          resolution: null, resolvedAt: null, resolvedBy: null, resolutionReason: null };
      } else {
        if (state === "not_configured") fail("trial-not-configured");
        Object.assign(record.trial, { resolution: action === "convert" ? "converted" : "terminated",
          resolvedAt: stamp(), resolvedBy: "mock", resolutionReason: payload.reason.trim() });
      }
      Object.assign(record.trial, { updatedAt: stamp(), updatedBy: "mock" });
      record.revision++;
      record.updatedAt = stamp();
      records.set(id, record);
      if (settings.lostResponse) throw { code: "functions/deadline-exceeded" };
      return structuredClone({ revision: record.revision, updatedAt: record.updatedAt, ...trialView(record.trial) });
    }
  };
  window.InneraAdminCore = {
    init() {},
    getDb() {
      return { collection(name) {
        if (name !== "clinics") throw new Error("Only local clinics fixture is supported");
        return { async get() { return { docs: Object.entries(clinics).map(([id, data]) => ({ id, data: () => ({ ...data }) })) }; } };
      } };
    }
  };
  // Existing action handlers remain loaded, but no external side effect is possible.
  window.firebase = {
    app: () => ({ functions: () => ({ httpsCallable: () => async () => { throw new Error("Mock preview: existing operations disabled"); } }) }),
    auth: () => ({ sendSignInLinkToEmail: async () => { throw new Error("No mail in mock preview"); } })
  };
  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.createElement("aside");
    panel.className = "detail-notice mock-controls";
    const title = document.createElement("strong");
    title.textContent = "F1-A 本機模擬｜所有院所均為虛構資料";
    panel.append(title);
    for (const [key, text] of [["readFailure", "模擬讀取失敗"], ["saveFailure", "模擬儲存失敗"]]) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.addEventListener("change", () => { settings[key] = input.checked; });
      label.append(input, document.createTextNode(text));
      panel.append(label);
    }
    const slow = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.addEventListener("change", () => { settings.delay = checkbox.checked ? 2500 : 350; });
    slow.append(checkbox, document.createTextNode("慢速讀取／儲存（2.5 秒）"));
    panel.append(slow);
    const links = document.createElement("nav");
    for (const [id, text] of [["mock-a", "有資料"], ["mock-b", "空白資料"], ["mock-special", "特殊字元"], ["missing", "不存在"]]) {
      const link = document.createElement("a");
      link.href = "#clinic/" + id;
      link.textContent = text;
      links.append(link, document.createTextNode("　"));
    }
    panel.append(links);
    const trialLabel = document.createElement("label");
    trialLabel.append(document.createTextNode("試用情境（目前院所）："));
    const select = document.createElement("select");
    for (const [value, text] of Object.entries({ not_configured: "尚未設定", scheduled: "未開始", active: "試用中", expired: "已到期", converted: "已轉正式合作", terminated: "已終止" })) {
      const option = document.createElement("option"); option.value = value; option.textContent = text; select.append(option);
    }
    select.addEventListener("change", () => {
      const id = decodeURIComponent(location.hash.slice("#clinic/".length));
      if (!clinics[id]) return;
      window.InneraClinicDetailsMock.seedTrial(select.value, id);
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    trialLabel.append(select); panel.append(trialLabel);
    document.querySelector(".admin-main").prepend(panel);
    for (const id of ["openCreateClinicButton", "adminLogoutButton"]) {
      const node = document.getElementById(id);
      node.disabled = true;
      node.title = "本機預覽不提供此操作";
    }
    document.dispatchEvent(new CustomEvent("innera:admin-ready"));
  });
})();
