// Central, fail-closed classification for the single Quizer callable API.
// Only actions proven read-only may share an in-flight request or feed
// stale-while-revalidate. Unknown actions are always treated as writes.
// Never classify "setStar" (or a future mutation) by a name prefix.
const READ_ACTIONS = new Set([
  "getSessionInfo", "listMyNotifications", "getDashboard",
  "listUsers", "listActivity", "getAdminUserActivity", "adminListContent", "listJobs",
  "listProblems", "getProblem", "listProblemRevisions",
  "listPublicQuizzes", "listMyQuizzes", "getQuizDraft", "getQuizDraftItems",
  "listQuizRevisions", "previewQuizRevision", "getJob", "getImportCheckpoint",
  "getQuizOverview", "resolveJoinLink", "listJoinLinks", "listMyApplications",
  "listTeacherRequests", "listAvailableQuizzes", "listAccessRequests",
  "lookupParticipant", "getAttempt", "getAttemptQuestions", "listMyAttempts",
  "getAnswerHistory", "getAttemptResult", "getTeacherAttempt", "getAdminAttempt",
  "listQuizAttempts", "listTeacherAttempts", "listGradeEvents",
  "getQuizProblemStats", "getQuizStatistics", "getQuizHistory", "getLegacyResponses",
  "getUploadUsage", "getAssetLinks", "getExportLink", "listStars",
]);

// Only on-demand collection summaries may persist in the small UI SWR cache.
// Never retain protected question/answer payloads or signed Storage URLs.
const CACHED_ACTIONS = new Set([
  "getDashboard", "listPublicQuizzes", "listMyQuizzes",
  "listAvailableQuizzes", "listMyAttempts", "listTeacherAttempts",
  "listProblems", "listMyNotifications", "listMyApplications",
  "listTeacherRequests",
]);
export const isReadAction = action => READ_ACTIONS.has(action);
export const mayCacheAction = action => CACHED_ACTIONS.has(action);

// Job polls start responsive but become less frequent during longer jobs.
// The deadline is still controlled by the caller, not by this schedule.
export function jobPollDelayMs(pollNumber) {
  if (!Number.isInteger(pollNumber) || pollNumber < 0)
    throw new TypeError("Invalid polling index");
  if (pollNumber < 8) return 1500;
  if (pollNumber < 16) return 2000;
  if (pollNumber < 24) return 3000;
  return 5000;
}
