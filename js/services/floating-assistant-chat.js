/**
 * Text-only floating Assistant handoff to the existing teacher Mimo callable.
 * Pure helpers, intentionally independent of Firebase, files, and provider keys.
 * Only confirmed exchanges may be sent as conversation history.
 */
const VALID_ROLES = new Set(["user", "assistant"]);

export function floatingAssistantHistory(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages.filter(row =>
    row && VALID_ROLES.has(row.role) && row.confirmed === true &&
    typeof row.text === "string" && row.text.trim()
  ).slice(-8).map(row => ({
    role: row.role,
    content: row.text.trim().slice(0, 1200),
  }));
}

export function prepareFloatingAssistantRequest({message, messages = [], requestId}) {
  if (typeof message !== "string" || !message.trim() || message.trim().length > 3000)
    throw new Error("Enter a message of at most 3000 characters.");
  if (typeof requestId !== "string" ||
      !/^[A-Za-z0-9_-]{16,100}$/.test(requestId))
    throw new Error("Invalid message reference.");
  return {
    message: message.trim(),
    context: "",
    history: floatingAssistantHistory(messages),
    requestId,
  };
}

export function isUncertainAssistantError(error) {
  const reason = String(error?.details?.reason || "");
  const code = String(error?.code || "").replace(/^functions\//, "");
  return reason === "MIMO_OUTCOME_UNKNOWN" ||
    ["deadline-exceeded", "unavailable", "internal", "unknown"].includes(code);
}
