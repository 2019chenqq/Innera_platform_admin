(function () {
  "use strict";

  const fields = [
    ["contactName", "合作聯絡窗口", 100],
    ["contactTitle", "聯絡窗口職稱／部門", 100],
    ["contactEmail", "合作聯絡 Email", 254],
    ["contactPhone", "合作聯絡電話", 50],
    ["clinicType", "院所類型"],
    ["cooperationNotes", "合作備註", 3000]
  ];
  const types = [
    ["", "未分類"], ["psychiatry_clinic", "精神科診所"],
    ["other_clinic", "其他診所"], ["hospital", "醫院"],
    ["counseling_center", "心理諮商所"], ["psychotherapy_center", "心理治療所"],
    ["other", "其他"]
  ];
  const blank = () => Object.fromEntries(fields.map(([key]) => [key, ""]));
  let ready = false;
  let generation = 0;
  let acceptedHash = "";
  let editing = false;
  let saving = false;
  let original = blank();
  let inputs = {};
  let provider;
  let session = null;
  let midnightTimer;
  const trialLabels = {
    not_configured: "尚未設定", scheduled: "未開始", active: "試用中",
    expired: "已到期", converted: "已轉正式合作", terminated: "已終止"
  };
  const taipeiDay = (now = Date.now()) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date(now));
    return ["year", "month", "day"].map(key => parts.find(p => p.type === key).value).join("-");
  };
  const validDay = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  const validStamp = value => value && Number.isSafeInteger(value.seconds) &&
    Number.isInteger(value.nanoseconds) && value.nanoseconds >= 0 && value.nanoseconds < 1e9;
  function checkedTrial(result) {
    const fail = () => { throw { code: "invalid-response" }; };
    const computed = result?.trialComputed, trial = result?.trial;
    if (!computed || !Object.hasOwn(trialLabels, computed.status) || !validStamp(result.evaluatedAt)) fail();
    if (computed.status === "not_configured") {
      if (trial !== null || computed.remainingDays !== null || computed.expiresAt !== null ||
          computed.lastTrialDate !== null || computed.endDateExclusive !== null) fail();
    } else {
      if (!trial || trial.schemaVersion !== 1 || trial.durationDays !== 84 || trial.timeZone !== "Asia/Taipei" ||
          !validDay(trial.startDate) || !validDay(computed.lastTrialDate) || !validDay(computed.endDateExclusive) ||
          !validStamp(computed.expiresAt) || !validStamp(trial.updatedAt)) fail();
      const terminal = ["converted", "terminated"].includes(computed.status);
      if (terminal ? trial.resolution !== computed.status || !validStamp(trial.resolvedAt) ||
          typeof trial.resolutionReason !== "string" || !trial.resolutionReason.trim() || trial.resolutionReason.length > 500
        : trial.resolution !== null) fail();
      if (computed.status === "active" ? !Number.isInteger(computed.remainingDays) || computed.remainingDays < 1 || computed.remainingDays > 84
        : computed.status === "expired" ? computed.remainingDays !== 0 : computed.remainingDays !== null) fail();
    }
    return result;
  }

  function callableAdapter() {
    async function call(name, data) {
      // Recheck on every request, including after a tab has been open for hours.
      window.InneraAdminCore.init();
      const app = window.firebase.app();
      const expected = window.INNERA_ADMIN_ENV?.projectId;
      if (!expected || window.INNERA_FIREBASE_CONFIG?.projectId !== expected ||
          app.options.projectId !== expected) {
        throw { code: "environment-mismatch" };
      }
      return (await app.functions("asia-east1").httpsCallable(name)(data)).data;
    }
    function checked(result, loading, expectedRevision) {
      const fail = () => { throw { code: "invalid-response" }; };
      if (!result || !Number.isSafeInteger(result.revision) || result.revision < 0) fail();
      if (loading && (!result.clinic || typeof result.clinic !== "object" || Array.isArray(result.clinic))) fail();
      if (result.operations === null) {
        if (!loading || result.revision !== 0) fail();
      } else {
        if (!result.operations || Array.isArray(result.operations) ||
            fields.some(([key]) => typeof result.operations[key] !== "string") ||
            validate(result.operations) || result.revision < 1) fail();
      }
      if (!loading && result.revision !== expectedRevision + 1) fail();
      return result;
    }
    return {
      mode: "callable",
      async load(clinicId) {
        return checkedTrial(checked(await call("getClinicDetails", { clinicId }), true));
      },
      async save(clinicId, operations, expectedRevision) {
        return checked(await call("updateClinicOperations", { clinicId, operations, expectedRevision }), false, expectedRevision);
      },
      async saveTrial(clinicId, action, payload, expectedRevision) {
        const result = checkedTrial(await call("updateClinicTrial", { clinicId, action, ...payload, expectedRevision }));
        if (result.revision !== expectedRevision + 1 || !validStamp(result.updatedAt)) throw { code: "invalid-response" };
        return result;
      }
    };
  }
  function failureText(error, writing = false) {
    switch (error?.code) {
      case "environment-mismatch": return "環境設定不一致，已停止操作。請重新開啟正確環境。";
      case "functions/unauthenticated": return "登入已失效，請重新登入；尚未儲存的輸入已保留。";
      case "functions/permission-denied": return "沒有存取此院所營運資料的權限。";
      case "functions/not-found": return "找不到此院所，請返回院所列表確認。";
      case "functions/invalid-argument": return "資料格式不符合要求，請檢查輸入。";
      default: return writing
        ? "無法確認儲存結果，輸入已保留。請先重新載入確認，勿重複送出。"
        : "無法讀取院所資料，請重試。";
    }
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function button(text, handler, className = "secondary-button") {
    const node = el("button", className, text);
    node.type = "button";
    node.addEventListener("click", handler);
    return node;
  }
  function values() {
    return Object.fromEntries(fields.map(([key]) => [key, inputs[key].value]));
  }
  function dirty() {
    return (editing && fields.some(([key]) => inputs[key].value !== original[key])) || !!session?.trialDirty?.();
  }
  function display(value) {
    return value === undefined || value === null || value === "" ? "未設定" : String(value);
  }
  function dateText(value) {
    if (!value) return "未設定";
    try {
      const date = value.toDate ? value.toDate() :
        typeof value.seconds === "number" ? new Date(value.seconds * 1000) : new Date(value);
      return Number.isNaN(date.getTime()) ? "未設定" :
        new Intl.DateTimeFormat("zh-TW", {
          timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit"
        }).format(date);
    } catch (_) {
      return "未設定";
    }
  }
  function validate(data) {
    for (const [key, label, max] of fields) {
      if (typeof data[key] !== "string") return { key, message: `${label}格式不正確。` };
      if (max && data[key].length > max) return { key, message: `${label}最多 ${max} 字。` };
    }
    if (data.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail)) {
      return { key: "contactEmail", message: "請輸入有效的合作聯絡 Email。" };
    }
    if (!types.some(([key]) => key === data.clinicType)) {
      return { key: "clinicType", message: "請選擇清單中的院所類型。" };
    }
    return null;
  }
  function definition(items) {
    const list = el("dl", "detail-grid");
    items.forEach(([label, value]) => {
      const group = el("div", "detail-field");
      group.append(el("dt", "", label), el("dd", "", display(value)));
      list.append(group);
    });
    return list;
  }
  function armMidnight() {
    clearTimeout(midnightTimer);
    if (!session || document.hidden) return;
    const midnight = Date.parse(taipeiDay() + "T00:00:00+08:00") + 86400000;
    midnightTimer = setTimeout(() => requestRefresh(), Math.max(1, midnight - Date.now() + 50));
  }
  function requestRefresh() {
    if (!session || document.hidden) return;
    clearTimeout(midnightTimer);
    if (saving) { session.refreshPending = true; return; }
    if (editing || session.trialEditing || session.blocked) {
      session.refreshPending = true;
      session.notice.textContent = "日期或頁面狀態已變更。輸入已保留，請確認重新載入最新資料後再操作。";
      session.blocked = true;
      session.notify();
      return;
    }
    session.reload(false);
  }
  function detailSession(id, result, ticket) {
    const state = { result, blocked: false, trialEditing: false, refreshPending: false, listeners: [] };
    state.notice = el("p", "form-message");
    state.notice.setAttribute("role", "status");
    state.notify = reset => state.listeners.forEach(listener => listener(reset));
    state.finish = () => {
      saving = false;
      state.notify();
      if (state.refreshPending && !state.blocked) requestRefresh();
    };
    state.reload = async (manual = true) => {
      if (saving || state !== session) return;
      if (manual && !window.confirm("重新載入最新資料會捨棄尚未儲存的輸入，並確認先前操作的結果。是否繼續？")) return;
      state.refreshPending = false;
      saving = true;
      state.notify();
      state.notice.textContent = "正在重新載入最新資料…";
      try {
        const latest = await provider.load(id);
        if (ticket !== generation) return;
        if (!latest) throw { code: "functions/not-found" };
        if (latest.revision < result.revision) throw { code: "invalid-response" };
        Object.assign(result, latest);
        state.blocked = editing = state.trialEditing = false;
        state.notify(true);
        state.notice.textContent = "已載入最新資料，請確認後再編輯。";
        armMidnight();
      } catch (error) {
        if (ticket !== generation) return;
        state.blocked = true;
        state.notice.textContent = failureText(error) + " 原輸入仍保留。請確認後重新載入。";
      } finally {
        if (ticket === generation) state.finish();
      }
    };
    return state;
  }
  function operationCard(id, result, ticket, shared) {
    const card = el("section", "detail-card");
    card.append(el("h2", "", "平台營運資料"));
    card.append(el("p", "detail-caption", "平台內部營運資料，不同步至醫療端院所設定。"));
    if (provider.mode === "mock") {
      card.append(el("p", "detail-notice", "本機 UI 模擬｜僅存於目前分頁記憶體，重新整理即重設，不會寫入雲端。"));
    }
    const metadata = el("p", "detail-caption");
    const renderMetadata = () => {
      metadata.textContent = `版本：${result.revision} · 最後修改時間：${
        result.updatedAt ? dateText(result.updatedAt) : result.operations ? "未提供" : "尚無紀錄"
      }`;
    };
    renderMetadata();
    card.append(metadata);
    let blockedSave = false;
    original = { ...blank(), ...(result.operations || {}) };
    const readView = el("div");
    const form = el("form", "operations-form");
    form.hidden = true;
    form.noValidate = true;
    const grid = el("div", "detail-form-grid");
    inputs = {};
    fields.forEach(([key, label, max]) => {
      const group = el("div", key === "cooperationNotes" ? "form-group detail-full" : "form-group");
      const labelNode = el("label", "", label);
      labelNode.htmlFor = `operation-${key}`;
      const input = el(key === "clinicType" ? "select" : key === "cooperationNotes" ? "textarea" : "input");
      input.id = `operation-${key}`;
      input.name = key;
      if (key === "clinicType") {
        types.forEach(([value, title]) => {
          const option = el("option", "", title);
          option.value = value;
          input.append(option);
        });
      } else {
        if (key !== "cooperationNotes") input.type = key === "contactEmail" ? "email" : key === "contactPhone" ? "tel" : "text";
        else input.rows = 6;
        input.maxLength = max;
      }
      const hint = el("small", "", max ? `選填，最多 ${max} 字${key === "cooperationNotes" ? "，僅接受純文字" : ""}` : "選填");
      hint.id = `operation-${key}-hint`;
      input.setAttribute("aria-describedby", `${hint.id} operation-message`);
      inputs[key] = input;
      group.append(labelNode, input, hint);
      grid.append(group);
    });
    const message = el("p", "form-message");
    message.id = "operation-message";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    const edit = button("編輯", () => {
      if (saving || shared.blocked || shared.trialEditing) return;
      editing = true;
      fields.forEach(([key]) => { inputs[key].value = original[key]; });
      message.textContent = "";
      readView.hidden = true;
      form.hidden = false;
      inputs.contactName.focus();
      shared.notify();
    });
    const renderRead = () => {
      readView.replaceChildren();
      if (!result.operations && provider.mode === "mock") {
        readView.append(el("p", "detail-caption", "尚無本機營運資料，可點擊編輯開始填寫。"));
      } else if (!result.operations) {
        readView.append(el("p", "detail-caption", "尚無營運資料，可點擊編輯開始填寫。"));
      }
      const rows = fields.map(([key, label]) => [
        label, key === "clinicType" ? types.find(([value]) => value === original[key])?.[1] || "未分類" : original[key]
      ]);
      readView.append(definition(rows), edit);
    };
    const cancel = button("取消", () => {
      editing = false;
      message.textContent = "";
      form.hidden = true;
      readView.hidden = false;
      edit.focus();
      shared.notify();
    });
    const save = el("button", "primary-button", provider.mode === "mock" ? "儲存至本機 mock" : "儲存");
    save.type = "submit";
    const reload = button("重新載入最新資料", () => shared.reload());
    reload.hidden = true;
    const actions = el("div", "modal-actions");
    actions.append(cancel, save);
    form.append(grid, actions);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (saving || blockedSave || shared.blocked || shared.trialEditing) return;
      fields.forEach(([key]) => inputs[key].removeAttribute("aria-invalid"));
      const raw = values();
      const data = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value.trim()]));
      // Validate raw lengths as well, so padding cannot bypass the length limit.
      const error = validate(raw) || validate(data);
      if (error) {
        message.textContent = error.message;
        inputs[error.key].setAttribute("aria-invalid", "true");
        inputs[error.key].focus();
        return;
      }
      saving = true;
      shared.notify();
      save.disabled = cancel.disabled = true;
      Object.values(inputs).forEach(input => { input.disabled = true; });
      message.textContent = provider.mode === "mock" ? "正在儲存至本機 mock…" : "正在儲存…";
      try {
        const saved = await provider.save(id, data, result.revision || 0);
        if (ticket !== generation) return;
        original = { ...blank(), ...saved.operations };
        Object.assign(result, saved);
        editing = false;
        form.hidden = true;
        readView.hidden = false;
        renderRead();
        renderMetadata();
        reload.hidden = true;
        message.textContent = provider.mode === "mock"
          ? "已更新本機 mock；尚未儲存至雲端，重新整理即重設。" : "營運資料已儲存。";
        edit.focus();
      } catch (error) {
        if (ticket !== generation) return;
        if (provider.mode === "mock" && !error?.code) {
          message.textContent = "本機模擬儲存失敗，輸入已保留，請再試一次。";
        } else {
          const conflict = error?.code === "functions/failed-precondition" &&
            error.details?.reason === "revision-conflict";
          message.textContent = conflict
            ? "資料已被其他人修改。你的輸入已保留，請重新載入最新資料後再編輯。"
            : failureText(error, true);
          blockedSave = error?.code !== "functions/invalid-argument";
          shared.blocked = blockedSave;
          reload.hidden = false;
        }
      } finally {
        if (ticket === generation) {
          shared.finish();
        }
      }
    });
    renderRead();
    shared.listeners.push(reset => {
      if (reset) {
        blockedSave = editing = false;
        form.hidden = true;
        readView.hidden = false;
        message.textContent = "";
      }
      if (!editing) {
        original = { ...blank(), ...(result.operations || {}) };
        renderRead();
      }
      renderMetadata();
      reload.hidden = !shared.blocked;
      reload.disabled = saving;
      edit.disabled = saving || shared.blocked || shared.trialEditing;
      save.disabled = saving || blockedSave || shared.blocked || shared.trialEditing;
      cancel.disabled = saving;
      Object.values(inputs).forEach(input => { input.disabled = saving; });
    });
    card.append(readView, form, message, reload);
    return card;
  }
  function trialCard(id, result, ticket, shared) {
    const card = el("section", "detail-card trial-card");
    card.append(el("h2", "", "試用管理"), el("p", "detail-notice",
      "試用到期或終止不會自動停用院所或中斷資料存取。"));
    const readView = el("div");
    const form = el("form", "trial-form");
    form.hidden = true;
    form.noValidate = true;
    const heading = el("h3");
    const group = el("div", "form-group");
    const label = el("label");
    const date = el("input");
    date.type = "date";
    date.id = "trial-startDate";
    date.max = "9998-12-31";
    const reason = el("textarea");
    reason.id = "trial-reason";
    reason.rows = 3;
    // Validate the trimmed value, exactly as F2-B; native maxLength would reject valid padded input.
    const hint = el("small");
    hint.id = "trial-hint";
    for (const input of [date, reason]) input.setAttribute("aria-describedby", "trial-hint trial-message");
    const message = el("p", "form-message");
    message.id = "trial-message";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    let action = null, initialValue = "", lastTrigger;
    shared.trialDirty = () => shared.trialEditing && (action === "setStart" ? date.value : reason.value) !== initialValue;
    const startEdit = (next, title, trigger) => {
      if (saving || shared.blocked || editing) return;
      action = next;
      lastTrigger = trigger;
      shared.trialEditing = true;
      heading.textContent = title;
      label.textContent = action === "setStart" ? "試用開始日期（台北日期）" : "結案原因";
      label.htmlFor = action === "setStart" ? date.id : reason.id;
      date.hidden = action !== "setStart";
      reason.hidden = action === "setStart";
      date.min = taipeiDay();
      date.value = result.trial?.startDate || "";
      reason.value = "";
      initialValue = action === "setStart" ? date.value : reason.value;
      hint.textContent = action === "setStart" ? "不得早於台北當日。開始後無法直接改期；試用期間為 12 週／84 天。"
        : "必填，去除前後空白後 1～500 字元；結案後本階段不提供撤銷。";
      date.removeAttribute("aria-invalid");
      reason.removeAttribute("aria-invalid");
      message.textContent = "";
      form.hidden = false;
      shared.notify();
      (action === "setStart" ? date : reason).focus();
    };
    const cancel = button("取消", () => {
      shared.trialEditing = false;
      form.hidden = true;
      message.textContent = "";
      shared.notify();
      card.querySelector(`[data-trial-action="${lastTrigger}"]`)?.focus();
    });
    const save = el("button", "primary-button", "確認送出");
    save.type = "submit";
    const actions = el("div", "modal-actions");
    actions.append(cancel, save);
    group.append(label, date, reason, hint);
    form.append(heading, group, actions);
    const renderRead = () => {
      readView.replaceChildren();
      const t = result.trial, c = result.trialComputed;
      readView.append(el("p", "detail-caption", `版本：${result.revision} · 台北時間`));
      if (c.status === "not_configured") readView.append(el("p", "detail-caption",
        "尚未設定試用。設定開始日期後才會建立試用資料。"));
      const rows = [
        ["商業試用狀態", trialLabels[c.status]], ["開始日期", t?.startDate || "—"],
        ["試用期間", "12 週／84 天"], ["最後試用日", c.lastTrialDate || "—"],
        ["到期時間（台北時間）", c.expiresAt ? dateText(c.expiresAt) : "—"],
        ["剩餘天數", c.remainingDays === null ? "—" : `${c.remainingDays} 天`],
        ["最後修改時間", t?.updatedAt ? dateText(t.updatedAt) : "—"]
      ];
      if (["converted", "terminated"].includes(c.status)) rows.push(
        ["結案時間", dateText(t.resolvedAt)], ["結案原因", t.resolutionReason]);
      readView.append(definition(rows));
      const buttons = el("div", "trial-actions");
      const add = (key, title) => {
        const control = button(title, () => startEdit(key, title, key));
        control.dataset.trialAction = key;
        control.disabled = saving || shared.blocked || editing || shared.trialEditing;
        buttons.append(control);
      };
      if (["not_configured", "scheduled"].includes(c.status)) add("setStart", c.status === "not_configured" ? "設定開始日" : "調整開始日");
      if (["scheduled", "active", "expired"].includes(c.status)) { add("convert", "轉正式"); add("terminate", "終止"); }
      readView.append(buttons);
    };
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!shared.trialEditing || saving || shared.blocked || editing) return;
      date.removeAttribute("aria-invalid"); reason.removeAttribute("aria-invalid");
      const payload = action === "setStart" ? { startDate: date.value } : { reason: reason.value.trim() };
      let error;
      if (action === "setStart") {
        date.min = taipeiDay();
        if (!validDay(date.value) || date.value < date.min || date.value > date.max) error = "請輸入不早於台北當日的有效開始日期。";
        else if (date.value === result.trial?.startDate) error = "開始日期未變更，請調整日期或取消。";
      } else if (!payload.reason || payload.reason.length > 500) error = "結案原因去除前後空白後須為 1～500 字元。";
      if (error) {
        message.textContent = error;
        const input = action === "setStart" ? date : reason;
        input.setAttribute("aria-invalid", "true"); input.focus(); return;
      }
      const description = action === "setStart" ? `開始日期：${payload.startDate}，試用期間 12 週／84 天。`
        : `${action === "convert" ? "轉為正式合作" : "終止試用"}，原因：${payload.reason}\n結案後本階段不提供撤銷。`;
      if (!window.confirm(`確認${heading.textContent}？\n${description}\n試用到期或終止不會自動停用院所或中斷資料存取。`)) return;
      saving = true;
      shared.notify();
      message.textContent = "正在送出，請勿重複操作…";
      const expectedRevision = result.revision;
      try {
        const saved = checkedTrial(await provider.saveTrial(id, action, payload, expectedRevision));
        if (ticket !== generation) return;
        if (saved.revision !== expectedRevision + 1) throw { code: "invalid-response" };
        Object.assign(result, saved);
        if (!result.operations) result.operations = blank(); // F2-B initializes the six empty F1 fields.
        shared.trialEditing = false;
        form.hidden = true;
        message.textContent = provider.mode === "mock" ? "試用資料已更新至本機 mock，未寫入雲端。" : "試用資料已儲存。";
        card.querySelector("h2").tabIndex = -1;
        card.querySelector("h2").focus();
      } catch (error) {
        if (ticket !== generation) return;
        const conflict = error?.details?.reason === "revision-conflict";
        message.textContent = conflict ? "資料已被其他人修改。輸入已保留，請確認重新載入最新資料後再編輯。"
          : error?.code === "functions/failed-precondition" ? "試用狀態已變更或不允許此操作。輸入已保留，請重新載入確認。"
          : failureText(error, true);
        shared.blocked = error?.code !== "functions/invalid-argument";
      } finally {
        if (ticket === generation) shared.finish();
      }
    });
    const reload = button("重新載入最新資料", () => shared.reload());
    shared.listeners.push(reset => {
      if (reset) { form.hidden = true; action = null; message.textContent = ""; }
      renderRead();
      save.disabled = saving || shared.blocked || editing;
      cancel.disabled = date.disabled = reason.disabled = saving;
      reload.disabled = saving;
      reload.hidden = !shared.blocked;
    });
    reload.hidden = true;
    renderRead();
    card.append(readView, form, message, reload);
    return card;
  }
  async function route() {
    if (!ready) return;
    const hash = window.location.hash;
    if (hash !== acceptedHash && (saving || dirty())) {
      if (!window.confirm(saving
        ? "請求仍在處理，離開後儲存仍可能完成。確定要離開嗎？"
        : "院所資料尚未儲存，確定要離開並捨棄變更嗎？")) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search + acceptedHash);
        return;
      }
    }
    acceptedHash = hash;
    const ticket = ++generation;
    clearTimeout(midnightTimer);
    session = null;
    editing = saving = false;
    inputs = {};
    const view = document.getElementById("clinicDetailView");
    const list = document.getElementById("clinicListView");
    view.replaceChildren(); // Clear before any asynchronous read or another clinic render.
    view.hidden = !hash.startsWith("#clinic/");
    list.hidden = !view.hidden;
    if (view.hidden) return;
    const back = el("a", "detail-back", "← 返回院所列表");
    back.href = "#clinics";
    const heading = el("h1", "", "院所詳情");
    heading.tabIndex = -1;
    view.append(back, heading);
    heading.focus();
    const state = el("p", "detail-notice", "正在讀取院所資料…");
    state.setAttribute("role", "status");
    view.append(state);
    let id;
    try {
      id = decodeURIComponent(hash.slice("#clinic/".length));
      if (!id || id.includes("/")) throw new Error("invalid-id");
    } catch (_) {
      state.textContent = "院所連結格式不正確。";
      return;
    }
    try {
      const result = await provider.load(id);
      if (ticket !== generation) return;
      if (!result) {
        state.textContent = "找不到此院所，請返回院所列表。";
        return;
      }
      checkedTrial(result);
      state.remove();
      const clinic = result.clinic;
      heading.textContent = clinic.name || clinic.clinicName || "未命名院所";
      const card = el("section", "detail-card");
      const status = !clinic.status ? "未設定" : clinic.status === "active" ? "啟用中" :
        clinic.status === "inactive" ? "已停用" : `未知狀態（${clinic.status}）`;
      card.append(el("h2", "", "院所基本資料"), el("p", "detail-caption", "唯讀 · 醫療端院所設定"));
      card.append(definition([
        ["院所名稱", clinic.name || clinic.clinicName || "未命名院所"],
        ["院所代碼", clinic.clinicCode || clinic.code || id],
        ["文件 ID", id], ["院所狀態", status], ["醫療端院所電話", clinic.phone],
        ["地址", clinic.address], ["科別", clinic.defaultDepartment], ["建立時間", dateText(clinic.createdAt)]
      ]));
      const stack = el("div", "detail-stack");
      session = detailSession(id, result, ticket);
      stack.append(card, operationCard(id, result, ticket, session), trialCard(id, result, ticket, session), session.notice);
      view.append(stack);
      armMidnight();
    } catch (error) {
      if (ticket !== generation) return;
      state.textContent = failureText(error);
      view.append(button("重新讀取", route));
    }
  }
  document.addEventListener("innera:admin-ready", () => {
    if (ready) return;
    // Only the isolated preview server adds this marker and adapter.
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
    provider = local && document.body.dataset.inneraPreview === "mock" && window.InneraClinicDetailsMock?.mode === "mock"
      ? window.InneraClinicDetailsMock
      : callableAdapter();
    ready = true;
    route();
  });
  window.addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(midnightTimer);
    else requestRefresh();
  });
  window.addEventListener("pageshow", event => { if (event.persisted) requestRefresh(); });
  window.addEventListener("beforeunload", event => {
    if (!dirty() && !saving) return;
    event.preventDefault();
    event.returnValue = "";
  });
})();
