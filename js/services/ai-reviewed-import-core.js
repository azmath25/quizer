import {validateProblem,validateMetadata} from "../../shared/schema.js";

/** Pure final conversion. Never import unapproved or incomplete AI review. */
export function buildApprovedImportRecords(prepared,{
  title="Reviewed mathematics extraction",target="quiz",visibility="private",
}={}){
  if(!prepared||!Array.isArray(prepared.items)||!prepared.items.length||
      prepared.items.length>500||!["quiz","bank"].includes(target))
    throw new Error("Invalid reviewed import");
  const seen=new Set();
  return prepared.items.map((item,i)=>{
    if(typeof item.review_id!=="string"||!/^page\d+_item\d+$/.test(item.review_id)||
        seen.has(item.review_id)||!item.reviewed_by||!item.reviewed_at)
      throw new Error("Missing unique reviewed-question approval");
    seen.add(item.review_id);
    // Reviewed exports carry the immutable grading schema version. The
    // problem-creation contract accepts ONLY grading fields; it independently
    // attaches gradingVersion=1 during normalization. Never send that
    // metadata back as an untrusted grading field.
    if(!item.grading||typeof item.grading!=="object"||
       Array.isArray(item.grading))
      throw new Error("Invalid reviewed grading");
    const {gradingVersion,...grading}=item.grading;
    if(gradingVersion!==undefined&&gradingVersion!==1)
      throw new Error("Unsupported reviewed grading version");
    const normalized=validateProblem(item.content,grading);
    const metadata=validateMetadata({
      title:`${title} — ${i+1}`.slice(0,200),
      subject:"Mathematics",difficulty:"",tags:[],
      bankVisibility:target==="bank"?visibility:"private",
    });
    return {
      importItemKey:"problem_"+i,originalQuestionId:item.review_id,
      content:normalized.content,
      grading:((({gradingVersion,...fields})=>fields)(normalized.grading)),
      metadata,points:normalized.content.defaultPoints,
    };
  });
}
