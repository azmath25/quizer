// Quizer N-A3 cutover contract. A backend is pinned at attempt creation.
// New Neon IDs are generated ONLY by the trusted server (atn_ prefix),
// never by student JSON. Existing att_* Firebase attempts stay on Firestore.
// Route fail closed when new backend is unavailable: no duplicate writes.
// Pure contract only: NOT wired to the live callable router.
export const FIREBASE_ATTEMPTS="firestore_attempt_v2";
export const NEON_ATTEMPTS="neon_attempt_v2";
const ID=/^[A-Za-z0-9_-]{1,128}$/;
export function selectNewAttemptBackend({
  releaseApproved=false,serverFlag=false,firebaseProjectId="",
}={}){
  return releaseApproved===true&&serverFlag===true&&
    firebaseProjectId==="sat-quiz-fd317"
    ?NEON_ATTEMPTS:FIREBASE_ATTEMPTS;
}
export function routeExistingAttempt({attemptId,
  neonEnabled=false}={}){
  if(typeof attemptId!=="string"||!ID.test(attemptId))
    throw new TypeError("Valid attempt ID required.");
  if(attemptId.startsWith("atn_")){
    if(neonEnabled!==true)
      throw new Error("Neon attempt exists but its backend is unavailable.");
    return NEON_ATTEMPTS;
  }
  return FIREBASE_ATTEMPTS;
}
export function assertNewNeonId(attemptId){
  if(typeof attemptId!=="string"||
      !/^atn_[A-Za-z0-9_-]{1,124}$/.test(attemptId))
    throw new TypeError("Server-generated Neon attempt ID required.");
  return attemptId;
}
