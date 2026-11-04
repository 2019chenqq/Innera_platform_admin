# F2-C local trial UI

The existing detail controller adds a trial card below the F1 operations card.
No HTML entry point, backend, schema, Rules or deployment configuration changes.
Both Dashboard variants already load the same controller and CSS.

The card consumes the F2-B trial/trialComputed/evaluatedAt contract. Its Chinese
labels, dates and remaining days use the returned values; the UI does not calculate
trial status. The only browser date calculations validate input against Taipei
today and schedule a single next-midnight refresh. Restored visibility and persisted
pageshow also refresh. There is no polling interval. Navigation clears the timer.

F1 and F2 share one detail result/revision and in-flight lock. Only one card edits
at a time. Each successful write updates both cards' revision. F2 actions use the
existing inline form/button styles plus native confirmation. Closure reasons use
trimmed UTF-16 length 1–500, matching F2-B. Unknown/malformed responses fail closed.

Conflict/uncertain results retain inputs, lock both cards' writes and never retry
automatically. A confirmed successful reload replaces the shared snapshot. Failed
or cancelled reload preserves the draft. Responses with older revisions are
rejected; route generation checks prevent late responses painting another clinic.
Automatic refresh is deferred when editing or uncertain; the page asks for a
confirmed reload instead of discarding inputs. Events during a request are coalesced
into one follow-up refresh so a midnight crossing is not lost.

## Preview and tests

```powershell
node test/clinic-details-preview.cjs
node --test test/environment-isolation.test.cjs test/invitation-flow.test.cjs test/clinic-details.test.cjs
```

Preview: http://127.0.0.1:4173/dashboard.demo.html#clinic/mock-a
Use the local-only trial scenario selector for the six states. Mock data stays in
page memory and resets on reload. Firebase/config scripts are removed; CSP blocks
data connections. The fake backend state calculator exists only in the test fixture.

The browser suite covers F1 regression, all statuses and legal controls, dates/days,
set/reschedule/convert/terminate, confirmation cancellation, validation, double
submission, shared revision in both directions, conflicts, lost committed response,
confirmed reload, stale revision rejection, restore/midnight refresh, late response
navigation, callable payload and malformed responses, and 1280/390px layouts.
Set INNERA_TEST_SCREENSHOT_DIR to save screenshots. Uses an isolated headless
Chrome/Edge profile; no user browser profile or cloud data.

Leave FIRESTORE_EMULATOR_HOST unset for this batch. The existing optional F1
Emulator integration test is skipped; F2-D must verify real callable/auth/transaction/
Rules integration and medical access, and deployment compatibility/order. UI now
requires the F2-B read contract; deploy coordination is required before rollout.
No F2-D work or cloud verification is claimed here.

Local run on 2026-10-27: 80 tests, 79 passed, 0 failed, 1 skipped (the existing
optional F1 Firestore Emulator integration test). Desktop and phone screenshots
were inspected; both layouts fit without horizontal overflow. Final UI copy omits
implementation terminology; length validation still follows the F2-B contract.
