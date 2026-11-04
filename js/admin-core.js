// js/admin/admin-core.js
(function () {
  "use strict";

  let app = null;
  let auth = null;
  let db = null;

  function ensureFirebaseLoaded() {
    if (!window.firebase) {
      throw new Error(
        "Firebase SDK 尚未載入。請確認 admin.html 已引入 Firebase SDK。"
      );
    }

    if (!window.INNERA_FIREBASE_CONFIG) {
      throw new Error(
        "找不到 INNERA_FIREBASE_CONFIG。請確認 firebase-config.js 已載入。"
      );
    }
  }

  function initFirebase() {
    ensureFirebaseLoaded();
    const expected = window.INNERA_ADMIN_ENV?.projectId;
    if (!expected || window.INNERA_FIREBASE_CONFIG?.projectId !== expected) {
      throw new Error("管理後台環境設定不一致，已停止操作。");
    }


    if (window.firebase.apps && window.firebase.apps.length > 0) {
      app = window.firebase.app();
    } else {
      app = window.firebase.initializeApp(
        window.INNERA_FIREBASE_CONFIG
      );
    }

    if (window.firebase.app().options.projectId !== expected) {
      throw new Error("管理後台 Firebase 專案不一致，已停止操作。");
    }

    auth = window.firebase.auth();
    db = window.firebase.firestore();

    console.log("[Admin] Firebase initialized");

    return {
      app,
      auth,
      db
    };
  }

  async function getCurrentUser() {
    initFirebase();

    return new Promise((resolve) => {
      const unsubscribe =
        auth.onAuthStateChanged((user) => {
          unsubscribe();
          resolve(user || null);
        });
    });
  }

  async function getPlatformAdminProfile(uid) {
    initFirebase();

    const doc =
      await db
        .collection("platformAdmins")
        .doc(uid)
        .get();

    if (!doc.exists) {
      return null;
    }

    return {
      id: doc.id,
      ...doc.data()
    };
  }

  async function requirePlatformAdmin() {
    const user = await getCurrentUser();

    if (!user) {
      console.warn("[Admin] 尚未登入");

      return {
        allowed: false,
        reason: "not_authenticated"
      };
    }

    const profile =
      await getPlatformAdminProfile(user.uid);

    if (!profile) {
      console.warn(
        "[Admin] 此帳號不是平台管理員"
      );

      return {
        allowed: false,
        reason: "not_platform_admin",
        user
      };
    }

    if (
      profile.role !== "platform_admin" ||
      profile.status !== "active"
    ) {
      console.warn(
        "[Admin] 平台管理員帳號未啟用"
      );

      return {
        allowed: false,
        reason: "admin_inactive",
        user,
        profile
      };
    }

    return {
      allowed: true,
      user,
      profile
    };
  }

  async function logout() {
    initFirebase();

    await auth.signOut();

    window.location.href = window.INNERA_ADMIN_ENV.loginUrl;
  }

  function getDb() {
    initFirebase();

    return db;
  }

  function getAuth() {
    initFirebase();

    return auth;
  }

  window.InneraAdminCore = {
    init: initFirebase,
    getDb,
    getAuth,
    getCurrentUser,
    getPlatformAdminProfile,
    requirePlatformAdmin,
    logout
  };

  document.addEventListener(
    "DOMContentLoaded",
    async () => {
      try {
        initFirebase();

        const result =
          await requirePlatformAdmin();

        if (!result.allowed) {
          console.warn(
            "[Admin] Access denied:",
            result.reason
          );

          const clinicList =
            document.getElementById(
              "clinicList"
            );

          if (clinicList) {
            clinicList.innerHTML = `
              <div class="empty-state">
                目前帳號沒有平台管理員權限。
              </div>
            `;
          }

          window.location.href = window.INNERA_ADMIN_ENV.loginUrl;
          return;
        }

        console.log(
          "[Admin] Platform admin authenticated"
        );

        document.dispatchEvent(
          new CustomEvent(
            "innera:admin-ready",
            {
              detail: result
            }
          )
        );

      } catch (error) {
        console.error(
          "[Admin] 初始化失敗；請確認環境設定與登入權限"
        );

        const clinicList =
          document.getElementById(
            "clinicList"
          );

        if (clinicList) {
          clinicList.innerHTML = `
            <div class="empty-state">
              平台管理後台初始化失敗；請確認環境設定與登入權限。
            </div>
          `;
        }
      }
    }
  );

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      document
        .getElementById(
          "adminLogoutButton"
        )
        ?.addEventListener(
          "click",
          logout
        );
    }
  );

})();