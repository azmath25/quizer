// PROD1-P0: trusted Firebase-only draft state and provenance ports for
// teacher-authorized image links. SQL calls happen only via draftCompat
// OUTSIDE Firestore transactions; URL signing occurs only after rechecks.
import {assert,id} from "../../shared/schema.js";
import {requireTeacher} from "../neon/contracts.js";
export function createProd1AuthorImagePorts({
  enabled=false,db,resolveProblemOrigin,draftCompat,
}={}){
  if(enabled!==true)return Object.freeze({enabled:false});
  assert(db?.doc&&typeof db.runTransaction==="function"&&
    typeof resolveProblemOrigin==="function"&&
    typeof draftCompat?.getItems==="function",
    "FAILED_PRECONDITION","Trusted author-image dependencies required.");
  const read=async path=>{
    const snap=await db.doc(path).get();
    return snap.exists?snap.data():null;
  };
  async function loadOwnedDraft({actor,quizId}){
    requireTeacher(actor);
    const idOfQuiz=id(quizId);
    const [quiz,draft]=await Promise.all([
      read("quizzes/"+idOfQuiz),
      read("quizzes/"+idOfQuiz+"/drafts/current"),
    ]);
    assert(quiz?.lifecycle==="active"&&
      (quiz.ownerId===actor.uid||actor.role==="admin")&&
      draft&&Number.isInteger(draft.version)&&
      Array.isArray(draft.itemOrder)&&
      draft.itemOrder.length<=500,
      "RESOURCE_UNAVAILABLE","Owned quiz draft unavailable.");
    return {quiz,draft};
  }
  async function resolveDraftOrigin({actor,quizId}){
    const state=await loadOwnedDraft({actor,quizId});
    if(!state.draft.itemOrder.length)return "firestore_legacy";
    const kinds=new Set();
    const base="quizzes/"+id(quizId)+"/draftItems/";
    for(let i=0;i<state.draft.itemOrder.length;i+=20){
      const subset=state.draft.itemOrder.slice(i,i+20);
      const slots=await Promise.all(subset.map(itemId=>
        read(base+id(itemId))));
      for(let j=0;j<subset.length;j++){
        const slot=slots[j];
        assert(slot?.itemId===subset[j],"VERSION_CONFLICT",
          "Draft slot is unavailable.");
        const kind=await resolveProblemOrigin({
          actor,problemId:id(slot.problemId)});
        assert(["firestore_legacy","neon_revision"].includes(kind),
          "RESOURCE_UNAVAILABLE","Unknown draft problem origin.");
        kinds.add(kind);
      }
    }
    return kinds.size===1?[...kinds][0]:"hybrid";
  }
  async function recheckDraft({
    actor,quizId,draftVersion,itemOrder,
  }={}){
    requireTeacher(actor);
    const q=id(quizId);
    return db.runTransaction(async tx=>{
      const paths=["roles/"+actor.uid,"quizzes/"+q,
        "quizzes/"+q+"/drafts/current"];
      const [role,quiz,draft]=await Promise.all(paths.map(async path=>{
        const s=await tx.get(db.doc(path));
        return s.exists?s.data():null;
      }));
      return Boolean(role&&!["disabled"].includes(role.accountStatus)&&
        ["teacher","admin"].includes(role.role)&&
        quiz?.lifecycle==="active"&&
        (quiz.ownerId===actor.uid||role.role==="admin")&&
        draft?.version===draftVersion&&
        Array.isArray(draft.itemOrder)&&
        draft.itemOrder.length===itemOrder.length&&
        draft.itemOrder.every((x,i)=>x===itemOrder[i]));
    });
  }
  return Object.freeze({enabled:true,resolveProblemOrigin,
    resolveDraftOrigin,draftCompat,loadOwnedDraft,recheckDraft});
}
