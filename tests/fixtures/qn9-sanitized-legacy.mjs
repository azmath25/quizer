// QN9 synthetic fixture only. No user names, real IDs, answers or cloud paths.
import { fingerprint } from "../../functions/src/neon/write-repository.js";
const content = (value, asset) => ({
  type:"open",answerMode:"auto",statementLatex:"Find "+value+"+1",
  options:[],defaultPoints:2,
  questionAssetBindings:asset?{"synthetic-figure.png":"ast_figure"}:{},
});
const grade = value => ({
  gradingVersion:1,correctOptionId:null,acceptedAnswers:[String(value+1)],
  tolerance:0.000001,explanationLatex:"",rubricLatex:"",
  solutionAssetBindings:{},
});
const tm="2026-10-01T10:00:00.000Z";
function addProblem(docs,i,withPrevious) {
  const id="prb_synth_"+i, first="prv_"+i+"_1", latest="prv_"+i+"_2";
  const m={
    schemaVersion:2,ownerId:"teacher_synthetic",
    ownerDisplayName:"Synthetic teacher",title:"Synthetic problem "+i,
    subject:"Math",difficulty:"Practice",tags:["synthetic"],
    bankVisibility:"private",lifecycle:"active",version:2,
    latestRevisionId:latest,revisionNumber:2,
    createdAt:tm,updatedAt:tm,
  };
  docs["problems/"+id]=m;
  for(const [rId,n] of [[first,1],[latest,2]]){
    const c=content(i+n, i===0);
    const g=grade(i+n);
    docs["problems/"+id+"/revisions/"+rId]={
      ...c,schemaVersion:2,
      revisionNumber:n,createdBy:"teacher_synthetic",createdAt:tm,
      source:{importJobId:null,sourceAssetId:"ast_original_tex",
        originalQuestionId:"q_"+i},
      contentHash:fingerprint({content:c,grading:g}),
    };
    docs["problems/"+id+"/revisions/"+rId+"/grading/main"]={
      ...g,createdAt:tm,
    };
  }
  return {problemId:id,oldRevisionId:first,latestRevisionId:latest};
}
export function syntheticLegacySnapshot(n=2) {
  if(!Number.isInteger(n)||n<1||n>500)throw Error("fixture size 1..500");
  const docs={
    "assets/ast_original_tex":{ownerId:"teacher_synthetic",status:"ready",
      kind:"source",storagePath:"staging/synthetic-source.tex",referenceCount:1},
    "assets/ast_figure":{ownerId:"teacher_synthetic",status:"ready",
      kind:"image",storagePath:"staging/synthetic-figure.png",referenceCount:1},
    "assets/ast_original_tex/refs/ref_synth":{target:"problems/prb_synth_0/source"},
    "assets/ast_figure/refs/ref_synth":{target:"problems/prb_synth_0/revisions/prv_0_1"},
    "quizzes/quiz_synthetic":{schemaVersion:2,ownerId:"teacher_synthetic",
      publishedRevisionId:"qrv_new",lastPublishedRevisionId:"qrv_new",
      lifecycle:"active",title:"Synthetic quiz",visibility:"private",
      createdAt:tm,updatedAt:tm},
    "quizzes/quiz_old_style":{schemaVersion:1,ownerId:"teacher_synthetic",
      legacyData:{keep:"unchanged"}},
  };
  const slots=[];
  for(let i=0;i<n;i++){
    const p=addProblem(docs,i);
    const itemId="itm_"+i;
    slots.push({itemId,...p});
    docs["quizzes/quiz_synthetic/draftItems/"+itemId]={
      itemId,problemId:p.problemId,
      problemRevisionId:p.latestRevisionId,points:2,
      reuseFromQuizRevisionId:null,
    };
    for(const [revisionId,problemRevisionId,value] of [
      ["qrv_old",p.oldRevisionId,i+1],
      ["qrv_new",p.latestRevisionId,i+2],
    ]){
      const c=content(value,i===0),g=grade(value);
      docs["quizzes/quiz_synthetic/revisions/"+revisionId+"/items/"+itemId]={
        ...c,itemId,problemId:p.problemId,
        problemRevisionId,points:2,
      };
      docs["quizzes/quiz_synthetic/revisions/"+revisionId+"/grading/"+itemId]=g;
    }
  }
  docs["quizzes/quiz_synthetic/drafts/current"]={
    version:4,title:"Synthetic quiz",description:"",subject:"Math",
    difficulty:"Practice",settings:{allowBack:false},
    itemOrder:slots.map(s=>s.itemId),
  };
  for(const revisionId of ["qrv_old","qrv_new"])
    docs["quizzes/quiz_synthetic/revisions/"+revisionId]={
      schemaVersion:2,state:"ready",revisionNumber:revisionId==="qrv_old"?1:2,
      title:"Synthetic quiz",itemOrder:slots.map(s=>s.itemId),
      itemCount:n,totalPoints:n*2,settings:{allowBack:false},
      createdAt:tm,readyAt:tm,
    };
  docs["attempts/att_synthetic_old"]={
    quizId:"quiz_synthetic",quizRevisionId:"qrv_old",
    studentId:"student_synthetic",quizOwnerId:"teacher_synthetic",
    status:"submitted",gradeState:"final",
    ordinal:1,attemptKind:"standard",sourceAttemptId:null,
    quizTitle:"Synthetic quiz",studentDisplayName:"Synthetic student",
    studentEmail:"student@synthetic.invalid",
    settingsSnapshot:{durationSeconds:1200,allowBack:false,penalty:0,
      scoreRelease:"immediate",solutionRelease:"immediate"},
    scoreReleasedAt:tm,solutionsReleasedAt:tm,
    currentFrontier:0,uiState:{currentIndex:0,flaggedItemIds:[],version:1},
    order:slots.map(s=>s.itemId),optionOrder:{},
    answeredCount:1,answeredItemIds:["itm_0"],
    answerVersion:1,gradeVersion:1,
    totals:{score:2,possible:n*2,correct:1,incorrect:0,pending:0,
      skipped:n-1,partial:0,percentage:100/n},
    startedAt:tm,submittedAt:tm,lastSavedAt:tm,
  };
  docs["attempts/att_synthetic_old/answers/itm_0"]={
    value:"2",revision:1,updatedAt:tm,
  };
  docs["attempts/att_synthetic_old/grades/itm_0"]={
    score:2,awarded:2,possible:2,status:"correct",
    version:1,manualPoints:null,feedbackLatex:"",gradedAt:tm,
  };
  docs["quizzes/quiz_synthetic/participants/student_synthetic"]={
    accessStatus:"approved",attemptCount:1,
    latestAttemptId:"att_synthetic_old",
  };
  docs["catalog/quiz_synthetic"]={
    quizId:"quiz_synthetic",title:"Synthetic quiz",
    publishedRevisionId:"qrv_new",
  };
  docs["jobs/job_synthetic"]={
    kind:"publish_quiz",targetId:"quiz_synthetic",status:"succeeded",
    result:{revisionId:"qrv_new"},
  };
  return docs;
}
