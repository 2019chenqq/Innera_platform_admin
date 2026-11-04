// js/admin-create-clinic.js
(function () {
  "use strict";

  const modal =
    document.getElementById(
      "createClinicModal"
    );

  const openButton =
    document.getElementById(
      "openCreateClinicButton"
    );

  const closeButton =
    document.getElementById(
      "closeCreateClinicButton"
    );

  const cancelButton =
    document.getElementById(
      "cancelCreateClinicButton"
    );

  const form =
    document.getElementById(
      "createClinicForm"
    );

  const message =
    document.getElementById(
      "createClinicMessage"
    );


  function openModal() {
    modal?.classList.remove(
      "hidden"
    );
  }


  function closeModal() {
    modal?.classList.add(
      "hidden"
    );

    form?.reset();

    if (message) {
      message.textContent = "";
    }
  }


  openButton?.addEventListener(
    "click",
    openModal
  );


  closeButton?.addEventListener(
    "click",
    closeModal
  );


  cancelButton?.addEventListener(
    "click",
    closeModal
  );


  modal?.addEventListener(
    "click",
    (event) => {

      if (
        event.target === modal
      ) {
        closeModal();
      }

    }
  );


  form?.addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();


      const clinicName =
        document
          .getElementById(
            "clinicName"
          )
          .value
          .trim();


      const adminName =
        document
          .getElementById(
            "adminName"
          )
          .value
          .trim();


      const email =
        document
          .getElementById(
            "adminEmail"
          )
          .value
          .trim();

      const submitButton =
        form.querySelector(
          'button[type="submit"]'
        );


      if (message) {
        message.textContent =
          "正在建立院所...";
      }


      if (submitButton) {
        submitButton.disabled =
          true;

        submitButton.textContent =
          "建立中...";
      }


      let created = false;
      let invitationReady = false;
      let emailSent = false;
      try {

        window.InneraAdminCore.init();

        const functions =
          firebase
            .app()
            .functions("asia-east1");


        const createClinic =
          functions.httpsCallable(
            "createClinic"
          );


        const result =
          await createClinic({
            clinicName,
            adminName,
            email,
          });


        if (result.data?.success !== true) throw new Error("Unconfirmed result");
        created = true;
        console.info("[Admin] clinic creation confirmed");

        const {
          inviteId,
          token,
          adminEmail,
          clinicCode
        } = result.data || {};

        if (
          !inviteId ||
          !token ||
          !adminEmail
        ) {
          throw new Error(
            "院所已建立，但啟用邀請資料不完整。"
          );
        }


        invitationReady = true;
        const activationUrl =
          new URL(
            window.INNERA_ADMIN_ENV.staffActivationUrl
          );

        activationUrl.searchParams.set(
          "invite",
          inviteId
        );

        activationUrl.searchParams.set(
          "token",
          token
        );


        try {
          await firebase
            .auth()
            .sendSignInLinkToEmail(
              adminEmail,
              {
                url:
                  activationUrl.toString(),

                handleCodeInApp:
                  true
              }
            );

          emailSent = true;

        } catch (emailError) {
          console.error(
            "[Admin] activation email request failed"
          );
        }


        if (message) {
          if (emailSent) {
            message.textContent =
              "院所及啟用邀請已建立，Firebase 已接受寄信請求；不代表收件人已收到郵件。";

          } else {
            message.textContent =
              "院所及啟用邀請已建立，但寄信請求失敗。請勿再次建立院所，可由院所清單重寄啟用信。";
          }
        }


        await window
          .InneraAdminClinics
          ?.load();


        if (emailSent) {
          setTimeout(
            closeModal,
            1200
          );
        }


      } catch (error) {

        console.error(
          "[Admin] create clinic flow did not complete"
        );


        let text =
          "目前無法確認院所是否已建立。請重新整理院所清單確認，勿直接再次建立。";


        switch (
          error.code
        ) {

        case "functions/already-exists":

          text =
            "已有相同的待處理資料。";

          break;


          case "functions/permission-denied":

            text =
              "你沒有建立院所的權限。";

            break;


          case "functions/unauthenticated":

            text =
              "登入已失效，請重新登入。";

            break;


          case "functions/invalid-argument":

            text =
              "輸入資料格式不正確。";

            break;


          default:

            text =
              "目前無法確認院所是否已建立。請重新整理院所清單確認，勿直接再次建立。";
        }

        if (created) {
          text = emailSent
            ? "院所及邀請已建立，Firebase 已接受寄信請求；清單更新未完成，請重新整理確認。"
            : invitationReady
              ? "院所及邀請已建立，但寄信流程未完成。請勿再次建立院所，請由清單確認並重寄啟用信。"
              : "院所已建立，但回傳的邀請資料不完整。請重新整理院所清單確認，勿再次建立。";
        }


        if (message) {
          message.textContent =
            text;
        }


      } finally {

        if (submitButton) {
          submitButton.disabled =
            false;

          submitButton.textContent =
            "建立院所";
        }

      }

    }
  );

})();
