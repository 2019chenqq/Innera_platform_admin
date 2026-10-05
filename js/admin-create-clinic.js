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


      try {

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


        console.log(
          "[Admin] createClinic success",
          result.data
        );

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


        let emailSent = false;

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
            "[Admin] activation email failed",
            emailError
          );
        }


        if (message) {
          if (emailSent) {
            message.textContent =
              `院所建立成功（${clinicCode}），管理員啟用信已寄出。`;

          } else {
            message.textContent =
              `院所已建立（${clinicCode}），但管理員啟用信寄送失敗。`;
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
          "[Admin] createClinic failed",
          error
        );


        let text =
          "建立院所失敗。";


        switch (
          error.code
        ) {

        case "functions/already-exists":

          text =
            error.message ||
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
              error.message ||
              "輸入資料格式不正確。";

            break;


          default:

            text =
              error.message ||
              "建立院所失敗。";
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