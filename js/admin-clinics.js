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

          const statusText =
            status === "active"
              ? "啟用中"
              : "停用";

          const statusClass =
            status === "active"
              ? ""
              : "inactive";

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

            </div>
          `;
        })
        .join("");
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
        snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        }));

      clinics.sort((a, b) => {
        const nameA =
          getClinicName(a);

        const nameB =
          getClinicName(b);

        return nameA.localeCompare(
          nameB,
          "zh-Hant"
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

})();