// Public deployment settings. The Functions region must match functions/src/config.js.
export const appConfig = {
  apiVersion: 2,
  functionsRegion: "europe-west1",
  appCheckSiteKey: "",
  emulators: {
    enabled: false,
    host: "127.0.0.1",
    auth: 9099,
    firestore: 8080,
    functions: 5001,
    storage: 9199,
  },
};
