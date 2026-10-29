// Internal browser QA transport. Never imported or copied into the production build.
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
const listeners = new Set();
const update = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn({ ...state }));
};
export const getSession = () => ({ ...state });
export function watchSession(fn) {
  listeners.add(fn);
  fn(getSession());
  return () => listeners.delete(fn);
}
async function request(path, data) {
  const response = await fetch("/__qa/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data || {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.message), {
      code: result.code,
      reason: result.reason,
      details: { reason: result.reason },
    });
  return result;
}
export const errorMessage = (error) => error.message;
export async function refreshSession() {
  const data = await request("session");
  update({ ...data, authResolved: true, roleResolved: true, status: "ready" });
}
let initialized;
export function initFirebase() {
  return (initialized ??= (async () => {
    try {
      await refreshSession();
    } catch (e) {
      update({ status: "error", error: e.message });
    }
    return services;
  })());
}
const services = {
  functions: {},
  functionsSDK: {
    httpsCallable: () => async (data) => ({ data: await request("api", data) }),
  },
  storage: {},
  storageSDK: {
    ref: (_storage, path) => path,
    uploadBytesResumable: (path, file, meta) => ({
      on: (_name, progress, reject, resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/__qa/upload?path=" + encodeURIComponent(path));
        xhr.setRequestHeader("Content-Type", meta.contentType);
        xhr.upload.onprogress = (event) =>
          progress({ bytesTransferred: event.loaded, totalBytes: event.total });
        xhr.onerror = () => reject(new Error("Image upload failed"));
        xhr.onload = () =>
          xhr.status === 200 ? resolve() : reject(new Error(xhr.responseText));
        xhr.send(file);
      },
    }),
  },
};
export async function getFirebaseServices() {
  await initFirebase();
  return services;
}
export async function loginWithEmail(email, password) {
  await request("login", { email, password });
  update({ epoch: state.epoch + 1 });
  await refreshSession();
}
export async function createAccount(name, email, password) {
  await request("register", { name, email, password });
  update({ epoch: state.epoch + 1 });
  await refreshSession();
}
export async function loginWithGoogle() {
  throw new Error(
    "Use an emulator test account for browser QA. Google OAuth requires the owner’s Firebase project.",
  );
}
export async function resetPassword(email) {
  return request("reset", { email });
}
export async function resendVerification() {
  return request("verify");
}
export async function reloadAccount() {
  return refreshSession();
}
export async function logout() {
  await request("logout");
  document.dispatchEvent(new Event("session-cleared"));
  for (const key of Object.keys(sessionStorage))
    if (key.startsWith("mathquiz.recovery.")) sessionStorage.removeItem(key);
  location.replace("index.html");
}
