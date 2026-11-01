import { api } from "./api.js";
import { uploadAsset } from "./assets.js";

export const IMPORT_KEY = "mathquiz.aiImport";
export const listChats = (cursor) => api("listChats", { limit: 50, cursor });
export const getChat = (chatId) => api("getChat", { chatId });
export const deleteChat = (chatId) => api("deleteChat", { chatId });
export const listJobs = () => api("listMyJobs", { limit: 30 });
export const getResult = (jobId) => api("getExtractionResult", { jobId });

export async function newChat(title, seed) {
  const { chatId } = await api("createChat", title ? { title } : {});
  if (seed?.length) await api("appendChatMessages", { chatId, messages: seed });
  return chatId;
}
export const addMessages = (chatId, messages) =>
  api("appendChatMessages", { chatId, messages });

// Uploads a PDF or image and queues an extraction job.
export async function queueExtraction(
  file,
  { chatId, target = "bulk", onProgress } = {},
) {
  const kind = file.type === "application/pdf" ? "document" : "image";
  const assetId = await uploadAsset(file, onProgress, kind);
  return api("createExtractionJob", {
    assetId,
    name: file.name,
    target,
    chatId,
  });
}

// Seeds a new chat with a problem's LaTeX and returns the page to open.
export async function openProblemInChat(latex, label = "Problem") {
  const chatId = await newChat(label, [
    {
      role: "user",
      text: "Help me with this problem:\n\n" + latex.slice(0, 6000),
    },
  ]);
  return `ai.html?chat=${chatId}`;
}

export function importResult(result, bank) {
  sessionStorage.setItem(
    IMPORT_KEY,
    JSON.stringify({ title: result.title, source: result.latex }),
  );
  return bank ? "upload.html?bank=1" : "upload.html";
}
