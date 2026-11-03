// QN3 interface design only, no runtime driver or live Neon connection.
// These types describe a private Firebase-Functions-to-Postgres port, NOT an API.

export type TrustedFirebaseActor = {
  uid: string;
  role: "teacher" | "admin";
  accountStatus: "active" | "disabled";
  emailVerified: true;
};

export type ProblemMetadata = {
  title: string;
  subject: string;
  difficulty: string;
  tags: string[];
  bankVisibility: "private" | "teachers";
};

export type ProblemHeader = ProblemMetadata & {
  id: string;
  problemId: string;
  ownerId: string;
  ownerDisplayName: string;
  latestRevisionId: string;
  revisionNumber: number;
  version: number;
  lifecycle: "active" | "trashed";
  updatedAt: string;
};

export type ProblemContent = {
  type: "open" | "choice";
  answerMode: "auto" | "manual";
  statementLatex: string;
  options: Array<{ id: string; textLatex: string }>;
  defaultPoints: number;
  questionAssetBindings: Record<string, string>; // Firebase Storage asset IDs
};

export type ProtectedProblemGrading = {
  correctOptionId: string | null;
  acceptedAnswers: string[];
  tolerance: number;
  explanationLatex: string;
  rubricLatex: string;
  solutionAssetBindings: Record<string, string>;
};

export type ProblemSource = {
  importJobId: string | null;
  sourceAssetId: string | null; // redacted to null for shared readers
  originalQuestionId: string | null;
};

export type ProblemRevision = {
  revisionId: string;
  revisionNumber: number;
  content: ProblemContent;
  grading: ProtectedProblemGrading;
  source: ProblemSource;
  contentHash: string;
};

export type InternalBankCursor = {
  updatedAt: string;
  problemId: string;
};

export interface ServerQueryPort {
  query(sql: string, params: readonly unknown[]): Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
}

export interface QuizerNeonReadRepository {
  getProblemForTeacher(input: {
    actor: TrustedFirebaseActor;
    problemId: string;
    revisionId?: string | null;
  }): Promise<{
    problemId: string;
    revisionId: string;
    problem: ProblemHeader;
    content: ProblemContent & {
      revisionNumber: number;
      contentHash: string;
      source: ProblemSource;
    };
    grading: ProtectedProblemGrading;
  }>;

  listProblemHeaders(input: {
    actor: TrustedFirebaseActor;
    view?: "mine" | "shared";
    lifecycle?: "active" | "trashed";
    search?: string;
    tag?: string;
    limit?: number;
    after?: InternalBankCursor | null;
  }): Promise<{ items: ProblemHeader[]; next: InternalBankCursor | null }>;
}

// Future QN8 implementation contract, NOT IMPLEMENTED IN QN3:
// createProblem, saveProblemRevision(expectedVersion), listProblemRevisions,
// changeSharing, trash/restore, bulkMetadataUpdate,
// importProblemBatch(jobId, importItemKey, payloadHash, content+grading) with
// transactionally created problem+revision+tags+import_receipt.
// Firestore quiz draft slots store problemId and revisionId only.
// QN10 publishes one private, immutable Storage bundle per quiz revision.
