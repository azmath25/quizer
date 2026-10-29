import { getFirebaseServices, getSession } from "../firebase-client.js";
import { api, waitForJob } from "./api.js";
const cache = new Map();
const knownLinks = new Map();
document.addEventListener("session-cleared", () => {
  cache.clear();
  knownLinks.clear();
});
// Reauthorize an expired image link when an image is loaded later (including an enlarged image).
document.addEventListener(
  "error",
  async (event) => {
    const img = event.target;
    if (
      !(img instanceof HTMLImageElement) ||
      Number(img.dataset.linkRetries || 0) >= 2
    )
      return;
    const old = knownLinks.get(img.getAttribute("src"));
    if (!old || old.epoch !== getSession().epoch) return;
    img.dataset.linkRetries = String(Number(img.dataset.linkRetries || 0) + 1);
    try {
      const result = await api("getAssetLinks", {
        context: old.context,
        assetIds: [old.assetId],
      });
      const link = result.links[0];
      if (!link || old.epoch !== getSession().epoch || !img.isConnected) return;
      knownLinks.set(link.url, old);
      cache.set(JSON.stringify(old.context) + old.assetId, {
        url: link.url,
        expires: Date.parse(link.expiresAt),
      });
      img.src = link.url;
    } catch {
      img.alt = "Image unavailable. Reload to check access.";
    }
  },
  true,
);
export async function uploadAsset(file, onProgress = () => {}, kind = "image") {
  const epoch = getSession().epoch,
    mime =
      kind === "source"
        ? file.name.endsWith(".json")
          ? "application/json"
          : "text/plain"
        : file.type;
  const reservation = await api("createAssetUpload", {
    kind,
    name: file.name,
    contentType: mime,
    expectedBytes: file.size,
  });
  const c = await getFirebaseServices();
  const task = c.storageSDK.uploadBytesResumable(
    c.storageSDK.ref(c.storage, reservation.stagingPath),
    file,
    { contentType: mime },
  );
  await new Promise((resolve, reject) =>
    task.on(
      "state_changed",
      (snapshot) =>
        onProgress({
          stage: "Uploading",
          percent: Math.round(
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100,
          ),
        }),
      reject,
      resolve,
    ),
  );
  if (epoch !== getSession().epoch)
    throw new Error("Your account changed during the upload.");
  const finalized = await api("finalizeAssetUpload", {
    assetId: reservation.assetId,
  });
  if (finalized.jobId)
    await waitForJob(finalized.jobId, (j) =>
      onProgress({ stage: j.progress.stage, percent: 100 }),
    );
  return reservation.assetId;
}
export async function resolveImages(bindings = {}, context) {
  const ids = [...new Set(Object.values(bindings))];
  if (!ids.length) return {};
  const scope = JSON.stringify(context),
    needed = ids.filter(
      (id) =>
        !cache.has(scope + id) ||
        cache.get(scope + id).expires < Date.now() + 15000,
    );
  for (let offset = 0; offset < needed.length; offset += 20) {
    const result = await api("getAssetLinks", {
      context,
      assetIds: needed.slice(offset, offset + 20),
    });
    for (const link of result.links) {
      knownLinks.set(link.url, {
        assetId: link.assetId,
        context,
        epoch: getSession().epoch,
      });
      cache.set(scope + link.assetId, {
        url: link.url,
        expires: Date.parse(link.expiresAt),
      });
    }
  }
  return Object.fromEntries(
    Object.entries(bindings).map(([alias, id]) => [
      alias,
      cache.get(scope + id)?.url,
    ]),
  );
}
