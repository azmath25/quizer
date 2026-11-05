// Pure evidence classifier. This does not resolve cross-store reads itself,
// perform repair, or decide which database should own mutable state.
// Sources are checked as exact (problemId, immutable revisionId) pairs.
const key=(problemId,revisionId)=>JSON.stringify([problemId,revisionId]);
export function classifyQuizSourceReferences({
  slots=[],neonPins=[],firebasePins=[],snapshotPins=[],
}={}){
  if(!Array.isArray(slots)||!Array.isArray(neonPins)||
      !Array.isArray(firebasePins)||!Array.isArray(snapshotPins))
    throw new TypeError("Invalid reconciliation input.");
  const index=list=>new Map(list.map(pin=>[
    key(pin.problemId,pin.problemRevisionId),pin,
  ]));
  const neon=index(neonPins),firebase=index(firebasePins),
    snapshot=new Set(snapshotPins.map(pin=>
      JSON.stringify([pin.quizId,pin.revisionId,pin.itemId])));
  const counts={total:0,neon:0,firestore:0,snapshot:0,
    missing:0,conflict:0,privateBundleUnknown:0,invalid:0};
  const anomalies=[];
  for(const slot of slots){
    counts.total++;
    if(!slot || typeof slot.problemId!=="string" ||
        typeof slot.problemRevisionId!=="string" ||
        typeof slot.itemId!=="string" ||
        typeof slot.quizId!=="string"){
      counts.invalid++;anomalies.push({kind:"invalid",slot});continue;
    }
    const pin=key(slot.problemId,slot.problemRevisionId);
    const inNeon=neon.has(pin),inFirebase=firebase.has(pin);
    if(inNeon&&inFirebase){
      counts.conflict++;anomalies.push({kind:"overlap",slot});
    } else if(inNeon)counts.neon++;
    else if(inFirebase)counts.firestore++;
    else if(slot.reuseFromQuizRevisionId &&
        snapshot.has(JSON.stringify([slot.quizId,
          slot.reuseFromQuizRevisionId,slot.itemId])))counts.snapshot++;
    else if(slot.privateBundleCandidate===true){
      // Don't falsely report a missing record: the prior answer-bearing
      // bundle requires its own private generation/SHA-verified read.
      counts.privateBundleUnknown++;
    }else{
      counts.missing++;anomalies.push({kind:"missing",slot});
    }
  }
  return {counts,anomalies};
}
