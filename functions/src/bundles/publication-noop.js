// Pure, read-only test for whether the published immutable revision already
// represents the saved draft. Never use a stale/last-published revision after
// Unpublish as a reason to suppress a new publication.
export function isCurrentPublishedDraft(quiz,draft,revision) {
  if(!quiz?.publishedRevisionId || quiz.publishingJobId ||
      !draft || !revision || revision.state!=="ready" ||
      !Number.isSafeInteger(draft.version) ||
      revision.sourceDraftVersion!==draft.version ||
      !Array.isArray(draft.itemOrder) ||
      !Array.isArray(revision.itemOrder) ||
      draft.itemOrder.length!==revision.itemOrder.length ||
      revision.itemCount!==draft.itemOrder.length)
    return false;

  for(let i=0;i<draft.itemOrder.length;i++)
    if(draft.itemOrder[i]!==revision.itemOrder[i])return false;
  for(const key of ["title","description","subject","difficulty"])
    if(draft[key]!==revision[key])return false;

  // A schema-upgraded draft must not accidentally be treated as unchanged
  // when its published settings differ. No silent data transformations.
  if(!draft.settings || !revision.settings ||
      typeof draft.settings!=="object" ||
      typeof revision.settings!=="object")return false;
  const a=Object.keys(draft.settings).sort(),b=Object.keys(revision.settings).sort();
  if(a.length!==b.length || a.some((key,i)=>key!==b[i]))return false;
  return a.every(key=>Object.is(draft.settings[key],revision.settings[key]));
}
