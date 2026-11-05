// QN11.6.3 — trusted Firestore scope for private attempt/result images.
// No Storage, Neon, or signed URLs in a Firestore transaction.
import {assert,id} from "../../shared/schema.js";
import {transact,requireRole,released,millis} from "../domain/runtime.js";
import {attemptManager} from "../api/attempts.js";

export function createFirestorePrivateImageScope({enabled=false,db}={}){
  if(enabled!==true)return Object.freeze({
    enabled:false,resolve:async()=>({disabled:true}),
  });
  assert(db?.doc&&typeof db.runTransaction==="function",
    "INVALID_FIELDS","Trusted Firebase transaction client required.");
  async function resolve({firebaseAuth,attemptId,kind}={}){
    id(attemptId,"attempt ID");
    assert(["attempt","result"].includes(kind),
      "INVALID_FIELDS","Unknown private image context.");
    assert(firebaseAuth?.uid && firebaseAuth?.token &&
      typeof firebaseAuth.token==="object",
      "AUTH_REQUIRED","Verified Firebase caller required.");
    return transact(db,"bundle.image.scope",attemptId+"-"+kind,async c=>{
      requireRole(c.actor,"user");
      const a=await c.get("attempts/"+attemptId);
      const staff=attemptManager(c.actor,a);
      assert(staff || a.studentId===c.actor.uid,
        "RESOURCE_UNAVAILABLE","Attempt images unavailable.");
      assert(Array.isArray(a.order) && a.order.length>=1 &&
        a.order.length<=500 && new Set(a.order).size===a.order.length &&
        Number.isInteger(a.currentFrontier) &&
        a.currentFrontier>=0 && a.currentFrontier<a.order.length &&
        a.quizId && a.quizRevisionId &&
        a.settingsSnapshot && typeof a.settingsSnapshot.allowBack==="boolean",
        "RESOURCE_UNAVAILABLE","Pinned attempt image scope invalid.");
      if(kind==="attempt"){
        assert(a.status==="active","ATTEMPT_FROZEN",
          "Question images unavailable after submission.");
        assert(!a.deadlineAt || millis(c.now)<millis(a.deadlineAt),
          "ATTEMPT_EXPIRED","Attempt deadline has passed.");
      }else{
        assert(a.status!=="active" || staff,
          "RESOURCE_UNAVAILABLE","Results are not available.");
      }
      const itemIds=kind==="attempt" && !a.settingsSnapshot.allowBack && !staff
        ? [a.order[a.currentFrontier]] : [...a.order];
      return {authorized:true,attemptId,kind,
        itemIds,pinnedRevisionId:a.quizRevisionId,
        scoreVisible:staff||released(a,"score",c.now),
        solutionVisible:staff||released(a,"solutions",c.now)};
    },firebaseAuth);
  }
  return Object.freeze({enabled:true,resolve});
}
