# One-time Firebase setup

Visitors sign in and use the app. Only the site owner performs these steps. The frontend is GitHub Pages; Firebase supplies the backend. Uploading files to GitHub alone does not deploy that backend.

## 1. Enable the Firebase services

In [Firebase Console](https://console.firebase.google.com/), choose your project:

1. Register a **Web app** and copy its public configuration.
2. Enable **Authentication → Sign-in method → Email/Password** and **Google**. Set the Google provider support email.
3. In **Authentication → Settings → Authorized domains**, add your exact website hostname, such as `YOUR_ACCOUNT.github.io`. Do not include `https://` or a repository path. Add a custom domain if you use one. Add `localhost` separately for local testing if needed.
4. Create **Firestore Database**, Native mode, database ID **(default)**.
5. Create **Cloud Storage**, using your actual bucket name from the Console. New and older buckets can have different suffixes; do not guess it.
6. Enable billing (Blaze) for Cloud Functions and Storage. Set billing alerts. This is owner-operated infrastructure, not a charge made by the website itself.

The default Functions region is `europe-west1`. Choose your region before first deployment; keep `js/app-config.js` and `functions/src/config.js` consistent. Prefer a region close to your Firestore/Storage location.

## 2. Set public website configuration

Edit `js/firebase-config.js`:

```js
export const firebaseConfig = {
  apiKey: "YOUR_PUBLIC_WEB_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_ACTUAL_BUCKET_NAME",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_WEB_APP_ID"
};
```

Use the actual Console values. This browser configuration is public by design. Never place a service-account JSON key, Admin SDK credential or OAuth client secret in the project or GitHub repository. Keep `appConfig.emulators.enabled` **false** in production.

If you use a non-default bucket, set `STORAGE_BUCKET=YOUR_ACTUAL_BUCKET_NAME` in an ignored `functions/.env.YOUR_PROJECT_ID` file before Functions deployment. Otherwise Firebase's default bucket is used.

## 3. Install and deploy the backend

Install Node.js 22 and run from the extracted project folder:

```sh
npm ci
npm --prefix functions ci
npx firebase login
npx firebase deploy --only firestore,storage,functions --project YOUR_PROJECT_ID
```

The predeploy step copies `shared/` into `functions/shared/`. Three deployed functions serve the app: `api` (the versioned callable router), `processJob` (durable background jobs), and `scheduledMaintenance` (expired attempts and jobs). There are many API actions behind the one callable; you do not deploy each action separately.

Wait until all indexes are ready before opening the app to users. Deploy the supplied rules exactly. Client writes to scores, roles, grants, private content and raw attempt records are deliberately denied; authorized mutations go through Functions.

During Storage-rule deployment, accept Firebase's prompt to enable the service connection for **Storage rules reading Firestore**. Those rules check the current role and upload reservation. See the official [cross-service rules documentation](https://firebase.google.com/docs/storage/security/rules-conditions#enhance_with_firestore).

### Signed image URLs

Functions use generation-pinned, 120-second signed URLs. The Functions runtime service account needs object access to the selected bucket and permission to sign URLs. Enable the **IAM Service Account Credentials API** and grant the actual runtime service account **Service Account Token Creator on itself** if signing fails with `iam.serviceAccounts.signBlob` permission denied. Do not grant that role to students or browser clients. See [signed URL guidance](https://cloud.google.com/storage/docs/access-control/signing-urls-with-helpers).

### Bucket CORS

Copy `firebase/storage-cors.example.json`, replace its origin with your exact Pages/custom origin (no repository path), and apply it to your actual bucket:

```sh
gcloud storage buckets update gs://YOUR_ACTUAL_BUCKET_NAME --cors-file=firebase/storage-cors.example.json
```

This supports browser image/backup reads. CORS is not authorization; the Storage rules and signed URLs still enforce access. Remove local development origins if you do not need them in production.

## 4. Publish the frontend from a branch

Put all project files in your GitHub repository, preserving relative directories. Under **Settings → Pages**, select **Deploy from a branch → main → /(root)**. No Node Actions workflow is required. Remove the previous custom `pages.yml` if it still runs.

Test Google sign-in on the exact final hostname. An “address not enabled” error is fixed in **Firebase Authentication → Authorized domains**, not in Firestore rules. On mobile, allow the Google popup and avoid restricted embedded browsers.

## 5. Create the first administrator

1. Sign in to the website using your own account and verify your email.
2. Copy your UID from **Profile** (or Firebase Authentication).
3. Authenticate an owner-run Admin SDK environment locally, preferably with Application Default Credentials, for example `gcloud auth application-default login` using an authorized project owner account. Do not add credentials to the repository.
4. Run the bootstrap command without `--apply` to inspect it, then apply:

```sh
node scripts/bootstrap-admin.mjs --project YOUR_PROJECT_ID --uid YOUR_UID
node scripts/bootstrap-admin.mjs --project YOUR_PROJECT_ID --uid YOUR_UID --apply
```

The script creates the canonical role, administrator counter and audit event. It refuses to overwrite an already initialized active-admin setup. Refresh the website.

After bootstrap, use **Admin → Users** to make/unmake teachers and administrators, disable/re-enable accounts, and record a reason. Users cannot promote themselves. The last active administrator is protected against concurrent demotion or disable operations. Use this interface instead of manually changing role documents and leaving the counter inconsistent.

## 6. App Check and production smoke test

The app supports reCAPTCHA Enterprise App Check. Register your web app, add its site key to `appConfig.appCheckSiteKey`, observe metrics, then set `ENFORCE_APP_CHECK=true` in your Functions environment and redeploy. Do not enable enforcement before legitimate clients can obtain tokens. Enforcement is off in the supplied configuration so a missing key does not lock out the initial setup. See [Firebase App Check](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider).

Perform the short [operations smoke test](docs/OPERATIONS.md) with two accounts. In particular, verify real Google OAuth, a separate image upload, signed image/backup downloads and the scheduled timeout job. These cloud IAM, billing and domain settings cannot be verified without your own project.

## Existing users and quizzes

Use [docs/MIGRATION.md](docs/MIGRATION.md) before cutover. Keep a Firestore export and Storage backup. Do not run the migration casually on an active production project; dry-run, resolve its report, then use a maintenance window. The script does not silently delete old quiz content or invent historical snapshots for old client-scored results.
