// Pure, bounded read plan for legacy Firestore quiz start. Published
// revision.itemOrder and totalPoints are already immutable/validated.
// Retry and shuffled-choice attempts retain full materialization.
export function initialQuizItemReads(order,{shuffleOptions=false,retry=false}={}){
  if(!Array.isArray(order)||order.length<1||order.length>500||
      new Set(order).size!==order.length||
      !order.every(item=>typeof item==="string"&&item.length>0))
    throw new TypeError("Invalid published question order.");
  return retry||shuffleOptions ? [...order] : [order[0]];
}
