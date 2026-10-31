import { firebaseConfig } from "./firebase-config.js";
import { appConfig } from "./app-config.js";
export const FIREBASE_SDK_VERSION = "13.1.0";
let state = {
  status: "initializing",
  authResolved: false,
  roleResolved: false,
  user: null,
  profile: null,
  role: "student",
  accountStatus: "active",
  capabilities: { teach: false, admin: false },
  epoch: 0,
  error: "",
};
let services, initialized, unsubscribeRole;
const listeners = new Set();
export const getSession = () => ({ ...state });
export function watchSession(fn) {
  listeners.add(fn);
  fn(getSession());
  return () => listeners.delete(fn);
}
function update(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(getSession());
}
const CACHE_KEY = "mathquiz.session.";
const CACHE_TTL = 5 * 60 * 1000;
function readCache(uid) {
  try {
    const hit = JSON.parse(sessionStorage.getItem(CACHE_KEY + uid));
    return hit && Date.now() - hit.at < CACHE_TTL ? hit.data : null;
  } catch {
    return null;
  }
}
function clearPrivate() {
  for (const key of Object.keys(sessionStorage))
    if (key.startsWith("mathquiz.recovery.") || key.startsWith(CACHE_KEY))
      sessionStorage.removeItem(key);
  document.dispatchEvent(new Event("session-cleared"));
}
export function errorMessage(error) {
  const code = error?.code?.replace(/^auth\//, "");
  return (
    {
      "unauthorized-domain":
        "Sign-in is not enabled for this website address. The site owner must add its hostname in Firebase Authentication.",
      "popup-blocked":
        "Your browser blocked the Google sign-in window. Allow pop-ups and try again.",
      "popup-closed-by-user": "Google sign-in was closed.",
      "invalid-credential": "The email or password is incorrect.",
      "email-already-in-use": "This email address already has an account.",
      "weak-password": "Use a stronger password with at least 8 characters.",
      "too-many-requests": "Too many attempts. Please try again later.",
      "network-request-failed":
        "Could not connect. Check your connection and try again.",
      "operation-not-allowed":
        "This sign-in method has not been enabled by the site owner.",
    }[code] ||
    error?.message ||
    "Something went wrong. Please retry."
  );
}
export async function refreshSession() {
  if (!services?.auth.currentUser) return;
  const uid = services.auth.currentUser.uid,
    epoch = state.epoch;
  try {
    const reply = await services.functionsSDK.httpsCallable(
      services.functions,
      "api",
    )({ apiVersion: 2, action: "getSessionInfo" });
    if (epoch !== state.epoch || services.auth.currentUser?.uid !== uid) return;
    const data = reply.data.data;
    try {
      sessionStorage.setItem(
        CACHE_KEY + uid,
        JSON.stringify({ at: Date.now(), data }),
      );
    } catch {}
    update({
      status: "ready",
      roleResolved: true,
      profile: data.profile,
      role: data.role,
      accountStatus: data.accountStatus,
      capabilities: data.capabilities,
      user: {
        uid,
        email: services.auth.currentUser.email,
        displayName: data.profile.displayName,
        emailVerified: services.auth.currentUser.emailVerified,
      },
      error: "",
    });
  } catch (error) {
    if (epoch === state.epoch)
      update({
        status: "error",
        roleResolved: false,
        error: errorMessage(error),
      });
  }
}
export function initFirebase() {
  if (initialized) return initialized;
  initialized = (async () => {
    if (!firebaseConfig.projectId && !appConfig.emulators.enabled) {
      update({
        status: "unconfigured",
        error: "The quiz service is not connected yet.",
      });
      return null;
    }
    try {
      if (
        appConfig.emulators.enabled &&
        !String(firebaseConfig.projectId || "demo-mathquiz-v2").startsWith(
          "demo-",
        )
      )
        throw new Error("Emulators require an isolated demo project.");
      const prefix = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/`;
      const [appSDK, authSDK, firestoreSDK, functionsSDK, storageSDK] =
        await Promise.all(
          ["app", "auth", "firestore", "functions", "storage"].map(
            (name) => import(prefix + `firebase-${name}.js`),
          ),
        );
      const config = appConfig.emulators.enabled
        ? {
            apiKey: "demo-key",
            authDomain: "demo-mathquiz-v2.firebaseapp.com",
            projectId: "demo-mathquiz-v2",
            appId: "demo-app",
            storageBucket: "demo-mathquiz-v2.appspot.com",
          }
        : firebaseConfig;
      const app = appSDK.getApps().length
          ? appSDK.getApp()
          : appSDK.initializeApp(config),
        auth = authSDK.getAuth(app),
        db = firestoreSDK.getFirestore(app),
        functions = functionsSDK.getFunctions(app, appConfig.functionsRegion),
        storage = storageSDK.getStorage(app);
      services = {
        app,
        auth,
        db,
        functions,
        storage,
        authSDK,
        firestoreSDK,
        functionsSDK,
        storageSDK,
      };
      if (appConfig.emulators.enabled) {
        const e = appConfig.emulators;
        authSDK.connectAuthEmulator(auth, `http://${e.host}:${e.auth}`, {
          disableWarnings: true,
        });
        firestoreSDK.connectFirestoreEmulator(db, e.host, e.firestore);
        functionsSDK.connectFunctionsEmulator(functions, e.host, e.functions);
        storageSDK.connectStorageEmulator(storage, e.host, e.storage);
      } else if (appConfig.appCheckSiteKey) {
        const ac = await import(prefix + "firebase-app-check.js");
        ac.initializeAppCheck(app, {
          provider: new ac.ReCaptchaEnterpriseProvider(
            appConfig.appCheckSiteKey,
          ),
          isTokenAutoRefreshEnabled: true,
        });
      }
      await authSDK.setPersistence(auth, authSDK.browserLocalPersistence);
      await new Promise((resolve, reject) => {
        let first = true;
        authSDK.onAuthStateChanged(
          auth,
          async (user) => {
            unsubscribeRole?.();
            unsubscribeRole = null;
            if (state.authResolved && state.user?.uid !== user?.uid)
              clearPrivate();
            update({
              authResolved: true,
              roleResolved: !user,
              user: user
                ? {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName,
                    emailVerified: user.emailVerified,
                  }
                : null,
              profile: null,
              role: "student",
              accountStatus: "active",
              capabilities: { teach: false, admin: false },
              status: user ? "role-loading" : "ready",
              epoch: state.epoch + 1,
              error: "",
            });
            if (user) {
              const cached = readCache(user.uid);
              if (cached)
                update({
                  status: "ready",
                  roleResolved: true,
                  profile: cached.profile,
                  role: cached.role,
                  accountStatus: cached.accountStatus,
                  capabilities: cached.capabilities,
                  user: {
                    uid: user.uid,
                    email: user.email,
                    displayName: cached.profile.displayName,
                    emailVerified: user.emailVerified,
                  },
                });
              const refreshed = refreshSession();
              if (!cached) await refreshed;
              if (auth.currentUser?.uid === user.uid) {
                unsubscribeRole = firestoreSDK.onSnapshot(
                  firestoreSDK.doc(db, "roles", user.uid),
                  (snap) => {
                    const role = snap.data();
                    if (
                      role &&
                      (role.role !== state.role ||
                        (role.accountStatus ?? "active") !==
                          state.accountStatus)
                    ) {
                      clearPrivate();
                      update({
                        capabilities: { teach: false, admin: false },
                        roleResolved: false,
                        epoch: state.epoch + 1,
                      });
                      refreshSession();
                    }
                  },
                  () => {
                    clearPrivate();
                    update({
                      status: "error",
                      roleResolved: false,
                      capabilities: { teach: false, admin: false },
                      epoch: state.epoch + 1,
                      error:
                        "Your permissions could not be checked. Reload to retry.",
                    });
                  },
                );
              }
            }
            if (first) {
              first = false;
              resolve();
            }
          },
          reject,
        );
      });
      return services;
    } catch (error) {
      update({ status: "error", error: errorMessage(error) });
      return null;
    }
  })();
  return initialized;
}
export async function getFirebaseServices() {
  if (!services) await initFirebase();
  if (!services)
    throw new Error(state.error || "The quiz service is unavailable.");
  return services;
}
export async function loginWithEmail(email, password) {
  const c = await getFirebaseServices();
  return c.authSDK.signInWithEmailAndPassword(c.auth, email.trim(), password);
}
export async function createAccount(name, email, password) {
  if (password.length < 8)
    throw new Error("Use at least 8 characters for your password.");
  const c = await getFirebaseServices();
  const result = await c.authSDK.createUserWithEmailAndPassword(
    c.auth,
    email.trim(),
    password,
  );
  await c.authSDK.updateProfile(result.user, {
    displayName: name.trim().slice(0, 100),
  });
  await c.authSDK.sendEmailVerification(result.user);
  await refreshSession();
  if (state.profile && name.trim())
    await c.functionsSDK.httpsCallable(
      c.functions,
      "api",
    )({
      apiVersion: 2,
      action: "updateProfile",
      requestId: crypto.randomUUID(),
      displayName: name.trim().slice(0, 100),
      expectedVersion: state.profile.version,
    });
  return result;
}
export async function loginWithGoogle() {
  const c = await getFirebaseServices(),
    provider = new c.authSDK.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return c.authSDK.signInWithPopup(c.auth, provider);
}
export async function resetPassword(email) {
  const c = await getFirebaseServices();
  return c.authSDK.sendPasswordResetEmail(c.auth, email.trim());
}
export async function resendVerification() {
  const c = await getFirebaseServices();
  if (c.auth.currentUser)
    await c.authSDK.sendEmailVerification(c.auth.currentUser);
}
export async function reloadAccount() {
  const c = await getFirebaseServices();
  if (!c.auth.currentUser) return;
  await c.authSDK.reload(c.auth.currentUser);
  await c.auth.currentUser.getIdToken(true);
  await refreshSession();
}
export async function logout() {
  clearPrivate();
  const c = await getFirebaseServices();
  await c.authSDK.signOut(c.auth);
  location.replace("index.html");
}
