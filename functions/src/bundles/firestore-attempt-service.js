// QN10.3: staged Firebase Admin SDK adapter for authorized private bundles.
// Never import into the active callable router until QN11/QN13 cutover gates.
// firebaseAuth is the VERIFIED request.auth from Firebase callable context;
// NEVER use a user-supplied JSON field as Firebase authentication.
import { assert, id } from "../../shared/schema.js";
import { millis } from "../domain/runtime.js";
import { createSecureBundleAttemptService } from "./secure-attempt-service.js";

const get = async(db,path) => {
  const snap=await db.doc(path).get();
  return snap.exists?snap.data():null;
};

export function createFirestoreSecureBundleService({
  enabled=false, db, privateStorage, serverNow=()=>new Date(),
}={}) {
  if(enabled!==true) return createSecureBundleAttemptService();
  assert(db && typeof db.doc==="function" &&
    privateStorage?.enabled === true &&
    typeof privateStorage.readExact==="function" &&
    typeof serverNow==="function",
    "INVALID_FIELDS","Trusted Firestore and private Storage ports required.");

  return createSecureBundleAttemptService({
    enabled:true,
    serverNow,
    async resolveFirebaseActor(verifiedCallableAuth) {
      assert(verifiedCallableAuth?.uid && verifiedCallableAuth.token &&
        typeof verifiedCallableAuth.token==="object",
        "AUTH_REQUIRED","Verified Firebase callable identity required.");
      const uid=id(verifiedCallableAuth.uid,"verified actor ID");
      const role=await get(db,"roles/"+uid);
      return {
        uid,role:role?.role??"student",
        accountStatus:role?.accountStatus??"active",
        emailVerified:verifiedCallableAuth.token.email_verified===true,
        email:verifiedCallableAuth.token.email??"",
        displayName:verifiedCallableAuth.token.name??"",
        roleVersion:role?.version??0,
      };
    },
    loadAttempt:attemptId=>get(db,"attempts/"+id(attemptId)),
    loadRevision:({quizId,revisionId})=>get(db,
      "quizzes/"+id(quizId)+"/revisions/"+id(revisionId)),
    readPrivateObject:args=>privateStorage.readExact(args),
    loadLegacyItem:({quizId,revisionId,itemId})=>get(db,
      "quizzes/"+id(quizId)+"/revisions/"+id(revisionId)+
      "/items/"+id(itemId)),
    loadLegacyGrading:({quizId,revisionId,itemId})=>get(db,
      "quizzes/"+id(quizId)+"/revisions/"+id(revisionId)+
      "/grading/"+id(itemId)),
    loadAnswer:({attemptId,itemId})=>get(db,
      "attempts/"+id(attemptId)+"/answers/"+id(itemId)),
    loadGrade:({attemptId,itemId})=>get(db,
      "attempts/"+id(attemptId)+"/grades/"+id(itemId)),
    async authorizeGradeJob({jobId,attemptId}) {
      const job=await get(db,"jobs/"+id(jobId));
      const now=serverNow();
      assert(job && job.kind==="grade_attempt" &&
        job.targetId===id(attemptId) &&
        job.status==="running" &&
        job.leaseOwner && job.leaseExpiresAt &&
        millis(job.leaseExpiresAt)>millis(now),
        "RESOURCE_UNAVAILABLE","Authorized live grading lease required.");
      return job;
    },
  });
}
