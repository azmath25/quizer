// QN11.5 — STAGED per-image signing after the private attempt access check.
// This does NOT sign published bundles, original source files, grading keys,
// or raw private Storage objects. No active router or worker imports this.
import {assert,id} from "../../shared/schema.js";
const SAFE_IMAGE_PATH=/^assets\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\/image\.(?:png|jpeg|jpg|gif|webp)$/;
export function createQuizerPrivateImageSigner({
  enabled=false,db,signImage,serverNow=()=>new Date(),
}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,signReadyAssets:async()=>({disabled:true}),
  });
  assert(db?.doc && typeof signImage==="function" &&
    typeof serverNow==="function",
    "INVALID_FIELDS","Trusted asset metadata and signing ports required.");
  async function signReadyAssets({firebaseAuth,assetIds}={}){
    assert(firebaseAuth?.uid && firebaseAuth?.token,
      "AUTH_REQUIRED","Verified Firebase identity required.");
    assert(Array.isArray(assetIds) && assetIds.length<=20 &&
      new Set(assetIds).size===assetIds.length,
      "INVALID_FIELDS","Sign at most 20 distinct authorized images.");
    const now=serverNow();
    assert(now instanceof Date && Number.isFinite(now.valueOf()),
      "INVALID_FIELDS","Trusted timestamp required.");
    const expiresAt=new Date(now.getTime()+120000);
    const links=[];
    for(const raw of assetIds){
      const assetId=id(raw,"asset ID");
      const snapshot=await db.doc("assets/"+assetId).get();
      const asset=snapshot.exists?snapshot.data():null;
      assert(asset?.kind==="image" && asset.status==="ready" &&
        SAFE_IMAGE_PATH.test(asset.storagePath??"") &&
        asset.storagePath.match(SAFE_IMAGE_PATH)?.[2]===assetId &&
        /^[1-9][0-9]{0,22}$/.test(String(asset.generation??"")),
        "RESOURCE_UNAVAILABLE","The selected image is not ready.");
      const url=await signImage({
        assetId,storagePath:asset.storagePath,
        generation:String(asset.generation),expiresAt,
      });
      assert(typeof url==="string" && url.startsWith("https://") &&
        !url.includes("published-bundles") &&
        !url.includes("firebaseStorageDownloadTokens") &&
        !url.includes("sources%2F"),
        "RESOURCE_UNAVAILABLE","Invalid private image link.");
      links.push({assetId,url,expiresAt,
        contentType:asset.contentType});
    }
    return {links};
  }
  return Object.freeze({enabled:true,signReadyAssets});
}
