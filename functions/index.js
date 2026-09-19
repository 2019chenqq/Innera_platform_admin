const { onCall, HttpsError } =
  require("firebase-functions/v2/https");

const {
  initializeApp
} = require("firebase-admin/app");

const {
  getAuth
} = require("firebase-admin/auth");

const {
  getFirestore,
  FieldValue
} = require("firebase-admin/firestore");


initializeApp();

const db = getFirestore();
const auth = getAuth();


async function assertPlatformAdmin(uid) {
  const snap =
    await db
      .collection("platformAdmins")
      .doc(uid)
      .get();

  if (!snap.exists) {
    throw new HttpsError(
      "permission-denied",
      "你不是平台管理員"
    );
  }

  const data = snap.data();

  if (
    data.role !== "platform_admin" ||
    data.status !== "active"
  ) {
    throw new HttpsError(
      "permission-denied",
      "平台管理員帳號目前不可用"
    );
  }

  return data;
}


function validateInput(data) {
  const clinicName =
    String(data.clinicName || "").trim();

  const adminName =
    String(data.adminName || "").trim();

  const email =
    String(data.email || "")
      .trim()
      .toLowerCase();

  const password =
    String(data.password || "");


  if (!clinicName) {
    throw new HttpsError(
      "invalid-argument",
      "請輸入院所名稱"
    );
  }

  if (!adminName) {
    throw new HttpsError(
      "invalid-argument",
      "請輸入院所管理員姓名"
    );
  }

  if (!email) {
    throw new HttpsError(
      "invalid-argument",
      "請輸入 Email"
    );
  }

  if (password.length < 6) {
    throw new HttpsError(
      "invalid-argument",
      "密碼至少需要 6 個字元"
    );
  }

  return {
    clinicName,
    adminName,
    email,
    password
  };
}


async function generateClinicCode() {
  const counterRef =
    db
      .collection("inneraCounters")
      .doc("clinic");

  const nextNumber =
    await db.runTransaction(
      async (transaction) => {

        const snap =
          await transaction.get(
            counterRef
          );

        let current = 0;

        if (snap.exists) {
          current =
            Number(
              snap.data().value || 0
            );
        }

        const next =
          current + 1;

        transaction.set(
          counterRef,
          {
            value: next,
            updatedAt:
              FieldValue.serverTimestamp()
          },
          {
            merge: true
          }
        );

        return next;
      }
    );

  return (
  "CL" +
  String(nextNumber).padStart(
    5,
    "0"
  )
);
}


exports.createClinic =
  onCall(
    {
      region: "asia-east1",
      invoker: "public"
    },
    async (request) => {

      if (!request.auth) {
        throw new HttpsError(
          "unauthenticated",
          "請先登入平台管理端"
        );
      }

      const callerUid =
        request.auth.uid;

      await assertPlatformAdmin(
        callerUid
      );


      const {
        clinicName,
        adminName,
        email,
        password
      } =
        validateInput(
          request.data || {}
        );


      let newUser = null;


      try {

        // 1. 建立 Auth 使用者
        newUser =
          await auth.createUser({
            email,
            password,
            displayName: adminName
          });


        // 2. 產生院所代碼
        const clinicCode =
          await generateClinicCode();


        // 3. 建立 clinic document
        const clinicRef =
          db
            .collection("clinics")
            .doc();


        // 4. 一次寫入 clinic + staff
        const batch =
          db.batch();


        batch.set(
          clinicRef,
          {
            name: clinicName,
            clinicCode,

            status: "active",

            createdAt:
              FieldValue.serverTimestamp(),

            createdBy:
              callerUid,

            primaryAdminUid:
              newUser.uid
          }
        );


        const staffRef =
          db
            .collection(
              "clinicStaff"
            )
            .doc(
              newUser.uid
            );


        batch.set(
          staffRef,
          {
            clinicId:
              clinicRef.id,

            name:
              adminName,

            email,

            role:
              "clinic_admin",

            status:
              "active",

            createdAt:
              FieldValue.serverTimestamp(),

            createdBy:
              callerUid
          }
        );


        await batch.commit();


        return {
          success: true,

          clinicId:
            clinicRef.id,

          clinicCode,

          staffUid:
            newUser.uid
        };


      } catch (error) {

        console.error(
          "[createClinic]",
          error
        );


        if (newUser) {
          try {
            await auth.deleteUser(
              newUser.uid
            );
          } catch (
            rollbackError
          ) {
            console.error(
              "[createClinic rollback]",
              rollbackError
            );
          }
        }


        if (
          error.code ===
          "auth/email-already-exists"
        ) {
          throw new HttpsError(
            "already-exists",
            "這個 Email 已經有 Firebase 帳號"
          );
        }


        if (
          error instanceof
          HttpsError
        ) {
          throw error;
        }


        throw new HttpsError(
          "internal",
          "建立院所失敗"
        );
      }
    }
  );
  exports.setClinicStatus = onCall(
  {
    region: "asia-east1",
    invoker: "public"
  },
  async (request) => {

    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "請先登入平台管理端"
      );
    }

    await assertPlatformAdmin(
      request.auth.uid
    );

    const clinicId =
      String(
        request.data?.clinicId || ""
      ).trim();

    const status =
      String(
        request.data?.status || ""
      ).trim();


    if (!clinicId) {
      throw new HttpsError(
        "invalid-argument",
        "缺少 clinicId"
      );
    }


    if (
      status !== "active" &&
      status !== "inactive"
    ) {
      throw new HttpsError(
        "invalid-argument",
        "不支援的院所狀態"
      );
    }


    const clinicRef =
      db
        .collection("clinics")
        .doc(clinicId);


    const clinicSnap =
      await clinicRef.get();


    if (!clinicSnap.exists) {
      throw new HttpsError(
        "not-found",
        "找不到院所"
      );
    }


    await clinicRef.update({
      status,

      updatedAt:
        FieldValue.serverTimestamp(),

      updatedBy:
        request.auth.uid
    });


    return {
      success: true,
      clinicId,
      status
    };
  }
);