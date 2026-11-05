"use strict";
const el = id => document.getElementById(id);
const expectedUid = "demo-encrypted-sleep-doctor";
const clinicId = "f2i-nonadmin-probe-never-created";
if (window.INNERA_FIREBASE_CONFIG.projectId !== "innera-demo") throw Error("Wrong project");
const app = firebase.initializeApp(window.INNERA_FIREBASE_CONFIG, "f2i-local-only");
const auth = app.auth();
let attempted = false;
const safeCode = error => /^(auth|functions)\/[a-z-]+$/.test(error?.code) ? error.code : "unknown-error";
el("login").addEventListener("submit", async event => {
  event.preventDefault();
  el("submit").disabled = true;
  try {
    await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
    await auth.signInWithEmailAndPassword(el("email").value, el("password").value);
    if (auth.currentUser?.uid !== expectedUid) {
      await auth.signOut();
      el("auth").textContent = "非指定合成帳號，已停止。";
      return;
    }
    el("auth").textContent = "Firebase Auth 登入成功（指定合成非管理員）";
    el("probe").disabled = attempted;
  } catch (error) {
    el("auth").textContent = "登入未成功：" + safeCode(error);
  } finally {
    el("password").value = "";
    el("submit").disabled = false;
  }
});
el("probe").addEventListener("click", async () => {
  if (attempted || auth.currentUser?.uid !== expectedUid) return;
  attempted = true;
  el("probe").disabled = true;
  const parts = new Intl.DateTimeFormat("en-US", {timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const part = type => parts.find(p => p.type === type).value;
  const startDate = `${part("year")}-${part("month")}-${part("day")}`;
  const tests = [["getClinicDetails", {clinicId}], ["updateClinicTrial", {clinicId, expectedRevision:0, action:"setStart", startDate}]];
  for (const [name, data] of tests) {
    try {
      await app.functions("asia-east1").httpsCallable(name)(data);
      el("result").textContent += `${name}: UNEXPECTED_SUCCESS — 停止\n`;
      break;
    } catch (error) {
      const code = safeCode(error);
      el("result").textContent += `${name}: ${code}${code === "functions/permission-denied" ? "（通過）" : "（未通過，停止）"}\n`;
      if (code !== "functions/permission-denied") break;
    }
  }
});
el("logout").addEventListener("click", async () => {
  await auth.signOut();
  el("password").value = "";
  el("auth").textContent = "已登出";
  el("probe").disabled = true;
});
