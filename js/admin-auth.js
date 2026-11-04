// js/admin-auth.js
(function () {
  "use strict";

  let auth = null;
  let db = null;


  function initFirebase() {

    if (!window.firebase) {
      throw new Error(
        "Firebase SDK 尚未載入"
      );
    }


    if (!window.INNERA_FIREBASE_CONFIG) {
      throw new Error(
        "找不到 Firebase 設定"
      );
    }


    const expected = window.INNERA_ADMIN_ENV?.projectId;
    if (!expected || window.INNERA_FIREBASE_CONFIG?.projectId !== expected) {
      throw new Error("管理後台環境設定不一致，已停止操作。");
    }

    if (
      window.firebase.apps &&
      window.firebase.apps.length > 0
    ) {

      window.firebase.app();

    } else {

      window.firebase.initializeApp(
        window.INNERA_FIREBASE_CONFIG
      );

    }


    if (window.firebase.app().options.projectId !== expected) {
      throw new Error("管理後台 Firebase 專案不一致，已停止操作。");
    }

    auth =
      window.firebase.auth();

    db =
      window.firebase.firestore();

  }


  async function checkPlatformAdmin(uid) {

    const snapshot =
      await db
        .collection("platformAdmins")
        .doc(uid)
        .get();


    if (!snapshot.exists) {
      return null;
    }


    return snapshot.data();

  }


  async function login(email, password) {
    initFirebase();

    const credential =
      await auth.signInWithEmailAndPassword(
        email,
        password
      );


    const user =
      credential.user;


    const admin =
      await checkPlatformAdmin(
        user.uid
      );


    if (!admin) {

      await auth.signOut();

      throw new Error(
        "此帳號沒有平台管理員權限"
      );

    }


    if (
      admin.role !== "platform_admin"
    ) {

      await auth.signOut();

      throw new Error(
        "帳號角色不是平台管理員"
      );

    }


    if (
      admin.status !== "active"
    ) {

      await auth.signOut();

      throw new Error(
        "平台管理員帳號目前未啟用"
      );

    }


    window.location.href =
      window.INNERA_ADMIN_ENV.dashboardUrl;

  }


  async function checkExistingLogin() {

    return new Promise((resolve) => {

      const unsubscribe =
        auth.onAuthStateChanged(
          async (user) => {

            unsubscribe();


            if (!user) {

              resolve();

              return;

            }


            try {

              const admin =
                await checkPlatformAdmin(
                  user.uid
                );


              if (
                admin &&
                admin.role ===
                  "platform_admin" &&
                admin.status ===
                  "active"
              ) {

                window.location.href =
                  window.INNERA_ADMIN_ENV.dashboardUrl;

              }


            } catch (error) {

              console.error(
                "[Admin Login] 登入狀態查詢失敗"
              );

            }


            resolve();

          }
        );

    });

  }


  document.addEventListener(
    "DOMContentLoaded",
    async () => {

      const form =
        document.getElementById(
          "adminLoginForm"
        );


      const emailInput =
        document.getElementById(
          "email"
        );


      const passwordInput =
        document.getElementById(
          "password"
        );


      const button =
        document.getElementById(
          "loginButton"
        );


      const message =
        document.getElementById(
          "loginMessage"
        );


      try {

        initFirebase();

        await checkExistingLogin();

      } catch (error) {

        console.error(
          "[Admin Login] 初始化失敗；請確認環境設定"
        );

        message.textContent =
          "平台登入初始化失敗；請確認環境設定。";
        button.disabled = true;
        return;

      }


      form?.addEventListener(
        "submit",
        async (event) => {

          event.preventDefault();


          message.textContent = "";


          button.disabled = true;

          button.textContent =
            "登入中...";


          try {

            await login(
              emailInput.value.trim(),
              passwordInput.value
            );


          } catch (error) {

            console.error(
              "[Admin Login] 登入失敗"
            );


            switch (
              error.code
            ) {

              case "auth/invalid-credential":

                message.textContent =
                  "Email 或密碼錯誤。";

                break;


              case "auth/invalid-email":

                message.textContent =
                  "Email 格式不正確。";

                break;


              case "auth/too-many-requests":

                message.textContent =
                  "登入嘗試次數過多，請稍後再試。";

                break;


              default:

                message.textContent =
                  "登入失敗。";

            }

          } finally {

            button.disabled = false;

            button.textContent =
              "登入平台";

          }

        }
      );

    }
  );

})();