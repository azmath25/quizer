/**
 * M2: existing Mimo extracted_page.v1 -> editable Quizer LaTeX source.
 *
 * Pure, local, GET-only conversion. Extraction is NOT mathematical proof:
 * model-supplied answers are explicitly unverified. A figure compiled for
 * a page is not automatically attached to a particular question.
 *
 * The result is a teacher-editable .tex draft, not a saved/imported quiz.
 * The existing Quizer parser is the sole compatibility authority.
 */
import {validateExtractedPage} from "./mimo-extraction.js";
import {parseLatex} from "./latex-parser.js";

export const MIMO_QUIZER_LATEX_SCHEMA = "quizer.mimo_latex_draft.v1";
const MAX_TEX_CHARS = 2 * 1024 * 1024;
const MAX_QUESTIONS = 500;
const hasOwn = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const object = o => o !== null && typeof o === "object" && !Array.isArray(o);
const escaped = text => String(text).replace(/(^|[^\\])%/gm, "$1\\%");
const comment = text => String(text).replace(/[\r\n%]/g, " ").replace(/\s+/g, " ").slice(0,250);
const heading = text => {
  const name = String(text || "Mimo mathematics extraction").trim();
  if(!name || name.length > 120 || !/^[\p{L}\p{N} ._-]+$/u.test(name))
    throw Error("Use a short plain-text quiz title without TeX controls.");
  return name;
};
const reason = (list, text) => { if(!list.includes(text)) list.push(text); };

export function buildMimoQuizerLatex({pages,title="Mimo mathematics extraction"}={}) {
  if(!Array.isArray(pages) || pages.length===0 || pages.length>100)
    throw Error("Select 1–100 completed Mimo pages.");
  const safeTitle=heading(title);
  const seenPages=new Set(),seenPrinted=new Map();
  let documentId=null,checksum=null;
  const ordered=pages.map(row=>{
    if(!object(row) || !object(row.page))
      throw Error("Missing completed page extraction.");
    const extracted=row.page;
    const page=validateExtractedPage({
      schema:extracted.schema,
      quality_status:extracted.quality_status,
      questions:extracted.questions,
    },extracted.source);
    const n=page.source.page_number;
    if(row.pageNumber!==n || seenPages.has(n))
      throw Error("Duplicate or mismatched source page number.");
    if(documentId===null){documentId=page.source.document_id;checksum=page.source.sha256;}
    if(page.source.document_id!==documentId || page.source.sha256!==checksum)
      throw Error("Cannot combine pages from different source documents.");
    if(typeof row.hasReconstruction!=="boolean" ||
       typeof row.verificationUnusable!=="boolean" ||
       typeof row.recoveredFromCheckpoint!=="boolean")
      throw Error("Missing extraction and verification status.");
    seenPages.add(n);
    return {page,number:n,hasReconstruction:row.hasReconstruction,
      verificationUnusable:row.verificationUnusable,
      recoveredFromCheckpoint:row.recoveredFromCheckpoint};
  }).sort((a,b)=>a.number-b.number);
  const items=[],issues=[],body=[];
  for(const source of ordered) {
    if(source.page.questions.length + items.length > MAX_QUESTIONS)
      throw Error("Quizer supports at most 500 questions per quiz.");
    for(const q of source.page.questions) {
      const number=q.printed_number,flags=[];
      if(seenPrinted.has(number))
        reason(flags,"Printed number repeats on page "+seenPrinted.get(number));
      seenPrinted.set(number,source.number);
      if(source.page.quality_status!=="pass" || q.review_required)
        reason(flags,"Extraction needs source review");
      if(source.verificationUnusable || source.recoveredFromCheckpoint)
        reason(flags,"Independent visual QA was unavailable or unusable");
      if(q.continuation!=="complete")
        reason(flags,"Question continues across pages or is uncertain");
      if(q.uncertain_spans.length)reason(flags,"Uncertain source text");
      for(const reviewReason of q.review_reasons) {
        if(flags.length>=20) break;
        reason(flags,"Extractor: "+comment(reviewReason));
      }
      const hasFigure=q.has_figure;
      if(hasFigure)
        reason(flags,source.hasReconstruction
          ?"Compiled page PNG is not bound to this question"
          :"Figure source/image requires reconstruction or linking");
      const missingKey=q.answer===null;
      if(missingKey)reason(flags,
        q.question_type==="multiple_choice"
          ?"Missing multiple-choice answer key"
          :"Missing answer — teacher must mark manually or supply a key");
      else reason(flags,"Model-extracted answer is not mathematically verified");
      // The existing extracted-page.v1 has NO solution field.
      reason(flags,"No verified solution provided by this Mimo output schema");
      const item={
        pageNumber:source.number,printedNumber:number,type:q.question_type,
        extractedAnswer:q.answer,answerStatus:missingKey?"missing":"model_unverified",
        solutionStatus:"not_provided",sourceQuality:source.page.quality_status,
        verificationStatus:source.verificationUnusable?"unusable":"visual_qa_only",
        figureRef:hasFigure?{
          jobId:documentId,pageNumber:source.number,
          artifact:source.hasReconstruction?"compile_png":"none",
          status:"unbound_to_question",
          description:q.figure_description,
        }:null,
        issues:flags,
        importerBlocked:missingKey&&q.question_type==="multiple_choice" ||
          hasFigure || q.continuation!=="complete" ||
          q.uncertain_spans.length>0 || source.page.quality_status==="fail",
      };
      items.push(item);
      const lines=[
        "% Mimo source page "+source.number+", printed question "+comment(number),
      ];
      if(q.has_figure)
        lines.push("% FIGURE UNBOUND — page "+source.number+
          (source.hasReconstruction?" has a compiled PNG; attach it only to the correct question.":" needs an image."));
      if(q.continuation!=="complete")
        lines.push("% UNRESOLVED CONTINUATION — "+comment(q.continuation));
      if(q.uncertain_spans.length)
        lines.push("% SOURCE UNCERTAIN — compare with original before import.");
      if(missingKey && q.question_type==="multiple_choice")
        lines.push("% MISSING ANSWER — add exactly one correctchoice after verifying the answer.");
      if(!missingKey)
        lines.push("% UNVERIFIED ANSWER — check against the source or solve independently.");
      lines.push("\\begin{problem}[points=1"+
        (missingKey&&q.question_type!=="multiple_choice"?",mode=manual":"")+"]");
      lines.push(escaped(q.statement_latex));
      if(q.question_type==="multiple_choice"){
        lines.push("\\begin{choices}");
        for(const opt of q.options)
          lines.push((opt.label===q.answer?"\\correctchoice ":"\\choice ")+escaped(opt.latex));
        lines.push("\\end{choices}");
      }else if(!missingKey){
        lines.push("\\answer{"+escaped(q.answer)+"}");
      }
      lines.push("\\end{problem}");
      body.push(lines.join("\n"));
      for(const flag of flags)
        issues.push({pageNumber:source.number,printedNumber:number,reason:flag});
    }
  }
  if(items.length===0)throw Error("No extracted questions to convert.");
  const latex="\\quiztitle{"+safeTitle+"}\n"+
    "% M2 editable draft: no key is claimed mathematically verified.\n"+
    "% No quiz or images are saved by this export.\n\n"+
    body.join("\n\n")+"\n";
  if(latex.length>MAX_TEX_CHARS)
    throw Error("Generated LaTeX exceeds the existing Quizer importer limit.");
  let importerCompatible=false,parserError=null;
  try {
    const parsed=parseLatex(latex,{filename:"mimo-draft.tex"});
    if(parsed.quiz.questions.length!==items.length)
      throw Error("Importer returned a different number of questions.");
    for(let i=0;i<items.length;i++){
      const item=items[i],actual=parsed.quiz.questions[i];
      if(actual.type!==(item.type==="multiple_choice"?"choice":"open"))
        throw Error("Importer changed a question type at index "+(i+1));
      if(item.type==="multiple_choice" && item.extractedAnswer!==null){
        const position=ordered
          .find(p=>p.number===item.pageNumber).page.questions
          .find(q=>q.printed_number===item.printedNumber).options
          .findIndex(o=>o.label===item.extractedAnswer);
        if(actual.answer!=="o"+(position+1))
          throw Error("Importer changed an answer at index "+(i+1));
      } else if(item.type!=="multiple_choice" && item.extractedAnswer!==null &&
         !actual.answers.includes(escaped(item.extractedAnswer))){
        throw Error("Importer changed an answer at index "+(i+1));
      }
    }
    importerCompatible=true;
  }catch(error){
    parserError=String(error?.message||"LaTeX importer rejected draft.").slice(0,300);
  }
  const blocked=items.filter(q=>q.importerBlocked).length;
  return {
    schema:MIMO_QUIZER_LATEX_SCHEMA,title:safeTitle,sourceJobId:documentId,
    pageNumbers:ordered.map(p=>p.number),latex,items,issues,
    summary:{
      pages:ordered.length,questions:items.length,
      modelAnswers:items.filter(q=>q.answerStatus==="model_unverified").length,
      missingAnswers:items.filter(q=>q.answerStatus==="missing").length,
      figuresUnbound:items.filter(q=>q.figureRef).length,
      missingSolutions:items.length,blocked,
    },
    importerCompatible,parserError,
    readyForAutomaticImport:false,
    automaticallySaved:false,published:false,
  };
}
