const modal =
  document.getElementById("createClinicModal");

const openButton =
  document.getElementById("openCreateClinicButton");

const closeButton =
  document.getElementById("closeCreateClinicButton");

const cancelButton =
  document.getElementById("cancelCreateClinicButton");

const form =
  document.getElementById("createClinicForm");

const message =
  document.getElementById("createClinicMessage");


function openModal() {

  modal.classList.remove("hidden");

}


function closeModal() {

  modal.classList.add("hidden");

  form.reset();

  message.textContent = "";

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

    if (event.target === modal) {
      closeModal();
    }

  }
);


form?.addEventListener(
  "submit",
  (event) => {

    event.preventDefault();

    const clinicName =
      document
        .getElementById("clinicName")
        .value
        .trim();

    const adminName =
      document
        .getElementById("adminName")
        .value
        .trim();

    const adminEmail =
      document
        .getElementById("adminEmail")
        .value
        .trim();

    const temporaryPassword =
      document
        .getElementById("temporaryPassword")
        .value;


    console.log({
      clinicName,
      adminName,
      adminEmail,
      temporaryPassword
    });


    message.textContent =
      "表單驗證成功。下一階段會接 Firebase Cloud Function。";

  }
);