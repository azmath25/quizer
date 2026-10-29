const prefix = "mathquiz.recovery.";
export function saveRecovery(uid, attemptId, data) {
  sessionStorage.setItem(
    prefix + uid + "." + attemptId,
    JSON.stringify({ expires: Date.now() + 86400000, ...data }),
  );
}
export function loadRecovery(uid, attemptId) {
  try {
    const key = prefix + uid + "." + attemptId,
      value = JSON.parse(sessionStorage.getItem(key));
    if (!value || value.expires < Date.now()) {
      sessionStorage.removeItem(key);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}
export function clearRecovery(uid, attemptId) {
  sessionStorage.removeItem(prefix + uid + "." + attemptId);
}
