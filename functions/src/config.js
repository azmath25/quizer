export const REGION = process.env.FUNCTIONS_REGION || "europe-west1";
export const DEMO =
  !!process.env.FIREBASE_STORAGE_EMULATOR_HOST &&
  (process.env.GCLOUD_PROJECT ?? "").startsWith("demo-");
export const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === "true";
