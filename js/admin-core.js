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

    if (window.firebase.apps && window.firebase.apps.length > 0) {
      app = window.firebase.app();
    } else {
      app = window.firebase.initializeApp(
        window.INNERA_FIREBASE_CONFIG
      );
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
    if (!auth) {
      initFirebase();
    }

    return new Promise((resolve) => {
      const unsubscribe =
        auth.onAuthStateChanged((user) => {
          unsubscribe();
          resolve(user || null);
        });
    });
  }

  async function getPlatformAdminProfile(uid) {
    if (!db) {
      initFirebase();
    }

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
    if (!auth) {
      initFirebase();
    }

    await auth.signOut();

    window.location.href = "./index.html";
  }

  function getDb() {
    if (!db) {
      initFirebase();
    }

    return db;
  }

  function getAuth() {
    if (!auth) {
      initFirebase();
    }

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

          return;
        }

        console.log(
          "[Admin] Platform admin authenticated:",
          result.profile
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
          "[Admin] 初始化失敗:",
          error
        );

        const clinicList =
          document.getElementById(
            "clinicList"
          );

        if (clinicList) {
          clinicList.innerHTML = `
            <div class="empty-state">
              平台管理後台初始化失敗。
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