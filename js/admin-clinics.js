// js/admin/admin-clinics.js
(function () {
  "use strict";

  let clinics = [];


  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }


  function getClinicName(clinic) {
    return (
      clinic.name ||
      clinic.clinicName ||
      "未命名院所"
    );
  }


  function getClinicCode(clinic) {
    return (
      clinic.clinicCode ||
      clinic.code ||
      clinic.id
    );
  }


  function getClinicStatus(clinic) {
    return clinic.status || "active";
  }


  function renderStats() {
    const clinicCount =
      document.getElementById(
        "clinicCount"
      );

    const activeClinicCount =
      document.getElementById(
        "activeClinicCount"
      );

    const activeCount =
      clinics.filter(
        (clinic) =>
          getClinicStatus(clinic) ===
          "active"
      ).length;


    if (clinicCount) {
      clinicCount.textContent =
        clinics.length;
    }


    if (activeClinicCount) {
      activeClinicCount.textContent =
        activeCount;
    }
  }


  function renderClinics() {
    const clinicList =
      document.getElementById(
        "clinicList"
      );


    if (!clinicList) {
      return;
    }


    if (clinics.length === 0) {
      clinicList.innerHTML = `
        <div class="empty-state">
          目前還沒有院所資料。
        </div>
      `;

      return;
    }


    clinicList.innerHTML =
      clinics
        .map((clinic) => {

          const name =
            getClinicName(clinic);

          const code =
            getClinicCode(clinic);

          const status =
            getClinicStatus(clinic);

          const isActive =
            status === "active";

          const statusText =
            isActive
              ? "啟用中"
              : "已停用";

          const statusClass =
            isActive
              ? ""
              : "inactive";

          const actionText =
            isActive
              ? "停用"
              : "重新啟用";

          const actionClass =
            isActive
              ? "danger"
              : "restore";

          const canResendInitialAdminInvite =
            isActive &&
            !clinic.primaryAdminUid &&
            Boolean(clinic.initialAdminInviteId);

          return `
            <div
              class="clinic-row"
              data-clinic-id="${escapeHtml(
                clinic.id
              )}"
            >

              <div>
                <div class="clinic-name">
                  ${escapeHtml(name)}
                </div>
              </div>


              <div class="clinic-code">
                ${escapeHtml(code)}
              </div>


              <div>
                <span
                  class="status-badge ${statusClass}"
                >
                  ${statusText}
                </span>
              </div>


              <div class="clinic-actions">

                ${
                  canResendInitialAdminInvite
                    ? `
                      <button
                        type="button"
                        class="clinic-resend-invite-button restore"
                        data-clinic-id="${escapeHtml(
                          clinic.id
                        )}"
                        data-clinic-name="${escapeHtml(
                          name
                        )}"
                      >
                        重寄啟用信
                      </button>
                    `
                    : ""
                }

                <button
                  type="button"
                  class="clinic-status-button ${actionClass}"
                  data-clinic-id="${escapeHtml(
                    clinic.id
                  )}"
                  data-clinic-name="${escapeHtml(
                    name
                  )}"
                  data-status="${escapeHtml(
                    status
                  )}"
                >
                  ${actionText}
                </button>

              </div>
              </div>
          `;
        })
        .join("");
  }


  async function updateClinicStatus(
    clinicId,
    nextStatus,
    button
  ) {

    try {

      if (button) {
        button.disabled = true;
        button.textContent =
          nextStatus === "inactive"
            ? "停用中..."
            : "啟用中...";
      }


      const functions =
        firebase
          .app()
          .functions("asia-east1");


      const setClinicStatus =
        functions.httpsCallable(
          "setClinicStatus"
        );


      const result =
        await setClinicStatus({
          clinicId,
          status: nextStatus
        });


      console.log(
        "[Admin] 更新院所狀態成功",
        result.data
      );


      await loadClinics();


    } catch (error) {

      console.error(
        "[Admin] 更新院所狀態失敗:",
        error
      );


      alert(
        error.message ||
        "更新院所狀態失敗。"
      );


      if (button) {
        button.disabled = false;
        button.textContent =
          nextStatus === "inactive"
            ? "停用"
            : "重新啟用";
      }
    }
  }

  async function resendInitialAdminInvite(
    clinicId,
    clinicName,
    button
  ) {
    const confirmed =
      window.confirm(
        `確定要重新寄送「${clinicName}」第一位管理員的帳號啟用信嗎？`
      );

    if (!confirmed) {
      return;
    }

    try {
      if (button) {
        button.disabled = true;
        button.textContent =
          "寄送中...";
      }

      const functions =
        firebase
          .app()
          .functions("asia-east1");

      const resendInvite =
        functions.httpsCallable(
          "resendInitialAdminInvite"
        );

      const result =
        await resendInvite({
          clinicId
        });

      const {
        inviteId,
        token,
        adminEmail
      } = result.data || {};

      if (
        !inviteId ||
        !token ||
        !adminEmail
      ) {
        throw new Error(
          "重新產生啟用邀請失敗。"
        );
      }

      const activationUrl =
        new URL(
          "https://2019chenqq.github.io/Innera_clinician/staff-activate.html"
        );

      activationUrl.searchParams.set(
        "invite",
        inviteId
      );

      activationUrl.searchParams.set(
        "token",
        token
      );

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

      alert(
        `「${clinicName}」的管理員啟用信已重新寄出。`
      );

    } catch (error) {
      console.error(
        "[Admin] 重新寄送管理員啟用信失敗:",
        error
      );

      alert(
        error.message ||
        "重新寄送管理員啟用信失敗。"
      );

    } finally {
      if (button) {
        button.disabled = false;
        button.textContent =
          "重寄啟用信";
      }
    }
  }

  async function handleClinicAction(
    event
  ) {

    const resendButton =
      event.target.closest(
        ".clinic-resend-invite-button"
      );

    if (resendButton) {
      const clinicId =
        resendButton.dataset.clinicId;

      const clinicName =
        resendButton.dataset.clinicName;

      if (!clinicId) {
        return;
      }

      await resendInitialAdminInvite(
        clinicId,
        clinicName,
        resendButton
      );

      return;
    }


    const button =
      event.target.closest(
        ".clinic-status-button"
      );


    if (!button) {
      return;
    }


    const clinicId =
      button.dataset.clinicId;

    const clinicName =
      button.dataset.clinicName;

    const currentStatus =
      button.dataset.status;


    if (!clinicId) {
      return;
    }


    const nextStatus =
      currentStatus === "active"
        ? "inactive"
        : "active";


    const confirmMessage =
      nextStatus === "inactive"
        ? `確定要停用「${clinicName}」嗎？\n\n停用後，該院所將無法繼續使用醫療端系統。`
        : `確定要重新啟用「${clinicName}」嗎？`;


    const confirmed =
      window.confirm(
        confirmMessage
      );


    if (!confirmed) {
      return;
    }


    await updateClinicStatus(
      clinicId,
      nextStatus,
      button
    );
  }


  async function loadClinics() {

    const clinicList =
      document.getElementById(
        "clinicList"
      );


    try {

      if (clinicList) {
        clinicList.innerHTML = `
          <div class="empty-state">
            正在載入院所資料...
          </div>
        `;
      }


      const db =
        window.InneraAdminCore.getDb();


      const snapshot =
        await db
          .collection("clinics")
          .get();


      clinics =
        snapshot.docs.map(
          (doc) => ({
            id: doc.id,
            ...doc.data()
          })
        );


      clinics.sort((a, b) => {

        const codeA =
          getClinicCode(a);

        const codeB =
          getClinicCode(b);


        return String(codeA)
          .localeCompare(
            String(codeB),
            "zh-Hant",
            {
              numeric: true
            }
          );
      });


      renderStats();
      renderClinics();


      console.log(
        `[Admin] 已載入 ${clinics.length} 間院所`
      );


    } catch (error) {

      console.error(
        "[Admin] 載入 clinics 失敗:",
        error
      );


      if (clinicList) {
        clinicList.innerHTML = `
          <div class="empty-state">
            無法載入院所資料。請查看 Console。
          </div>
        `;
      }
    }
  }


  function getClinics() {
    return [...clinics];
  }


  window.InneraAdminClinics = {
    load: loadClinics,
    getAll: getClinics
  };


  document.addEventListener(
    "innera:admin-ready",
    () => {
      loadClinics();
    }
  );


  document.addEventListener(
    "DOMContentLoaded",
    () => {

      const clinicList =
        document.getElementById(
          "clinicList"
        );


      clinicList?.addEventListener(
        "click",
        handleClinicAction
      );
    }
  );

})();