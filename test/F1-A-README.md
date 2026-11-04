# F1-A local UI preview

Run from `D:\QQ_Web\Innera_platform_admin`:

```powershell
node test/clinic-details-preview.cjs
```

Open <http://127.0.0.1:4173/dashboard.demo.html>. Production HTML can also be
previewed at `/dashboard.html`; both use the same UI scripts. Stop with Ctrl+C.

This test server transforms the existing Dashboard in memory. It removes Firebase
SDKs, environment config and auth/core scripts, and injects only local fictional
fixtures. CSP blocks network data connections. It serves an explicit file
allowlist, binds only to localhost, and never proxies cloud requests.

Use the preview controls for read failure, save failure and 2.5-second latency.
Links provide populated, empty, special-character and missing clinic examples.
Existing create/logout actions are disabled in this preview; status/resend mocks
cannot write or send mail. Production HTML is not modified by the server.

Mock operations live in a Map in the current page, persist across hash navigation,
and reset on page reload. The banner and save messages explicitly identify this.
Ordinary Dashboard pages never load this fixture. Since F1-C, they use
`getClinicDetails` and `updateClinicOperations` in `asia-east1` after
`innera:admin-ready`. Each request reruns the existing environment guard and checks
the app project against the selected config. A mock is selected only when the
localhost preview server adds its explicit body marker and fixture.

## Tests

```powershell
node --test test/environment-isolation.test.cjs test/invitation-flow.test.cjs test/clinic-details.test.cjs
```

Requires Node 24 and a local Chrome/Edge. If not installed at the standard Windows
path, set `INNERA_TEST_BROWSER` to its executable. Browser tests use a separate
temporary profile and localhost server; neither the user's profile nor cloud
data is used. A browser startup failure fails the suite rather than silently
skipping it. The temporary profile is removed after the suite.

Optional screenshots: set `INNERA_TEST_SCREENSHOT_DIR` to an output directory
before running the tests. The suite captures 1280px and 390px edit layouts.

## Callable adapter boundary (F1-C)

The details controller consumes:

```text
load(clinicId) ->
  null                                      // clinic missing
  { clinic, operations: null, revision: 0 } // operations not created
  { clinic, operations, revision }          // existing operations

save(clinicId, operations, expectedRevision) ->
  { operations, revision }
```

The real Callable reports a missing clinic as `functions/not-found`, rather than
returning an empty operations document. Invalid responses are rejected. Version
conflicts preserve the draft and block another save until the user explicitly
reloads; reload asks before discarding a draft and preserves it if loading fails.
Uncertain save errors do not retry the request or report success.

Load/save responses now include `updatedAt: { seconds, nanoseconds }`, or null
when no operations timestamp exists. This authorized response-only addition uses
the persisted Firestore server timestamp. Save reads the immutable audit record
from the same transaction to return the timestamp for its own committed revision,
even if another writer has advanced the operations document. A metadata read
failure reports an uncertain result without retrying the committed write.
The UI displays the returned time in Asia/Taipei, never browser-generated time.
Old records without a timestamp still show “最後修改時間：未提供”.

With `FIRESTORE_EMULATOR_HOST=127.0.0.1:8187`, the browser suite additionally runs
UI → local HTTP test transport → existing Callable handler → Firestore Emulator.
It uses a synthetic authenticated identity, not Firebase Auth/Functions Emulator
token verification. Without that variable this one integration test is skipped.
The normal preview server does not enable the HTTP transport.

`clinic` is read-only and uses `name || clinicName`, `clinicCode || code || id`,
`status`, `phone`, `address`, `defaultDepartment`, `createdAt`. Missing status
renders as “未設定”. `createdAt` accepts Firestore Timestamp or serialized
`{ seconds, nanoseconds }`; the mock uses an ISO string.

All six operation values are strings and optional:

| Key | Limit / values |
| --- | --- |
| contactName | 100 UTF-16 code units |
| contactTitle | 100 |
| contactEmail | 254, email format if non-empty |
| contactPhone | 50 |
| clinicType | `""`, `psychiatry_clinic`, `other_clinic`, `hospital`, `counseling_center`, `psychotherapy_center`, `other` |
| cooperationNotes | 3000, displayed only as text, never interpreted as HTML |

The UI trims values at save and validates raw lengths too. Empty string clears
a field; empty clinicType means unclassified. No clinic identity, status,
authorization or administrator fields are accepted by the form.

F1-C calls `getClinicDetails({clinicId})` and
`updateClinicOperations({clinicId, expectedRevision, operations})` using these
shapes. The backend independently enforces authorization, the six-field allowlist,
revision checks and atomic Audit writes. Neither the UI nor the preview writes
Firestore directly. No Rules change or deployment is part of F1-C.
