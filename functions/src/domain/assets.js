import { assert, id } from "../../shared/schema.js";
import { hash } from "./runtime.js";
export async function retainAssets(
  c,
  ids,
  target,
  ownerId,
  { authorizedCopy = false } = {},
) {
  for (const assetId of [...new Set(ids)]) {
    const asset = await c.get(`assets/${id(assetId)}`);
    assert(
      asset.status === "ready",
      "ASSET_NOT_READY",
      "An image is not ready. Finish uploading before saving.",
    );
    assert(
      authorizedCopy || asset.ownerId === ownerId || c.actor.role === "admin",
      "RESOURCE_UNAVAILABLE",
      "This image is unavailable.",
    );
    const refId = hash(target);
    const ref = await c.get(`assets/${assetId}/refs/${refId}`, false);
    if (!ref) {
      c.set(`assets/${assetId}/refs/${refId}`, { target, createdAt: c.now });
      c.set(`assets/${assetId}`, {
        ...asset,
        referenceCount: (asset.referenceCount ?? 0) + 1,
        version: asset.version + 1,
      });
    }
  }
}
