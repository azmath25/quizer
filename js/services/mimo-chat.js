/**
 * Browser transport for the teacher-only Mimo chat callable.
 * The browser never sees the Mimo project key, workflow ID, or upstream URL.
 * No automatic retries: an ambiguous submission may already be billable.
 */
import { getFirebaseServices, getSession } from "../firebase-client.js";

export async function sendTeacherChatMessage({
  message, context = "", history = [], requestId = crypto.randomUUID(),
} = {}) {
  const before = getSession();
  if (!before.user?.uid || before.capabilities?.teach !== true) {
    throw new Error("Teacher access is required to use Mimo chat.");
  }
  const c = await getFirebaseServices();
  const callable = c.functionsSDK.httpsCallable(c.functions, "mimoTeacherChat", {
    timeout: 115000,
  });
  const response = await callable({message, context, history, requestId});
  const after = getSession();
  if (after.epoch !== before.epoch || after.user?.uid !== before.user.uid) {
    throw new Error("Your account changed. Reload before continuing.");
  }
  const data = response?.data;
  if (typeof data?.reply !== "string" || !data.reply.trim()) {
    throw new Error("Mimo did not return a chat response.");
  }
  return {reply: data.reply, runId: data.runId};
}
