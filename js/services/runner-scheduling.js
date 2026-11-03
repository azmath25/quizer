// QN12-B: bounded student question prefetch and save-before-navigation.
// Browser-independent so ordering and concurrency can be regression-tested.
export async function saveBeforeNavigate(saveAnswers, navigateOnServer) {
  await saveAnswers();
  return navigateOnServer();
}
export async function prefetchQuestionBatches(ids, fetchPage, {
  batchSize=20, concurrency=2, shouldStop=()=>false,
}={}) {
  if(!Array.isArray(ids) || ids.length>500 ||
    typeof fetchPage!=="function" || typeof shouldStop!=="function" ||
    !Number.isInteger(batchSize) || batchSize<1 || batchSize>20 ||
    !Number.isInteger(concurrency) || concurrency<1 || concurrency>2)
    throw new TypeError("Invalid bounded question prefetch parameters.");
  let offset=0;
  const run=async()=>{
    while(!shouldStop()){
      const start=offset;
      offset+=batchSize;
      if(start>=ids.length)break;
      const page=ids.slice(start,start+batchSize);
      try {
        await fetchPage(page);
      }catch{
        // Prefetch is only an optimization. Failure must not prevent
        // the foreground question request from retrying on navigation.
      }
    }
  };
  await Promise.all(Array.from({length:Math.min(concurrency,
    Math.ceil(ids.length/batchSize))},run));
}
