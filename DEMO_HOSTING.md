# Isolated Demo Hosting release

Local preparation only. No site, DNS, authorized domain or deployment is created by build/check. Production remains GitHub Pages; pushing shared source to its publishing branch can still publish Production.

## Local commands

```powershell
node scripts/demo-hosting.cjs --build
node scripts/demo-hosting.cjs --check --project innera-demo --target admin-demo --config firebase.hosting.demo.json
node --test test/demo-hosting.test.cjs test/environment-isolation.test.cjs test/invitation-flow.test.cjs
node --test test/clinic-details.test.cjs
```

Run from Innera_platform_admin. Build produces ignored dist/admin-demo with 11 exact files. index.html is a generated copy of index.demo.html; existing relative login/logout and dashboard paths remain valid. Only Demo config and required common scripts/styles are included. No source fork is maintained. Unknown artifact files are rejected, never deleted. Do not publish the repository root or manually add files to the artifact.

Check intentionally fails until a verified site mapping exists. firebase.hosting.demo.mapping.example.json is a template, not an active mapping. After separate authorization creates a dedicated site in innera-demo, merge the template's targets.innera-demo.hosting.admin-demo entry into .firebaserc with its verified site ID; preserve existing project and target entries. Never guess an existing site or reuse a site serving another app. Local checks validate mapping structure, not cloud ownership; verify ownership before release.

## Future setup and release (not authorized by this batch)

1. Create a dedicated Hosting site under innera-demo; record its actual ID and confirm no existing content is replaced. Configure only target admin-demo as above.
2. Connect admin-demo.innerahealthcare.com using Firebase-provided DNS records, verify TLS, and review Cloudflare proxy/cache behavior. Leave admin.innerahealthcare.com and Production Pages settings unchanged.
3. Review Demo Auth authorized domains and add the new hostname if required under separate authorization. Keep the existing innera-demo.firebaseapp.com authDomain. New origin requires its own login; logout does not promise to log out other origins.
4. Preserve a reviewed artifact/release version for rollback. Run build, tests and check. All must pass. Verify both F1 Callables already exist in innera-demo/asia-east1 before publishing their UI.
5. Only with deployment approval, use the guarded entry point:

```powershell
node scripts/demo-hosting.cjs --execute --project innera-demo --target admin-demo --config firebase.hosting.demo.json
```

This invokes only hosting:admin-demo with explicit project/config and non-interactive mode, never Functions or Rules, force, or automatic retry. The Hosting predeploy check also validates content. This is an accident-prevention guard, not an IAM boundary; users who modify config/scripts can bypass it. Never use broad firebase deploy or rely on the Production default project.

6. Verify root login, login/logout redirects, dashboard refresh/hash navigation, JS/CSS loading, F1 requests to innera-demo in asia-east1, and absence of Production requests. Use approved fictional fixtures only. Invitation URL remains https://clinician.innerahealthcare.com/staff-activate-demo.html; verify its Demo environment separately without sending real invitations. No mock adapter is shipped. Common JS retains its existing isolated-preview support but normal HTML supplies no mock marker/provider.

Hosting sends no-cache for HTML/JS/CSS to revalidate stable filenames. No new CSP is introduced; a later CSP must account for current inline code and Firebase CDN/API endpoints. F1 Callable CORS uses its existing defaults; verify the new origin without changing backend authorization.

Stop on any environment mismatch, unknown site ownership, failed tests/check, missing Functions, asset failure or unexpected Production request. Do not relax the guard to proceed.

## Rollback

With separate approval, select the prior release for this Demo site only in Firebase Hosting Release history and roll back. Confirm content and config version and revalidate browser caches. Alternatively rebuild the recorded source/artifact revision and pass the same exact guard before targeted redeployment. Do not reset the developer working tree, alter Production Pages, delete the site or roll back database records. For a first release, prepare an approved maintenance artifact before cloud release because no previous Hosting release exists yet.
