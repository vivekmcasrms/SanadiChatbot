/** Shared, typed contracts for the agent layer. Safe to import on the client. */

export type Lang = "en" | "ar";

/** Server-provided working-agent presentation, shared by text and voice. */
export type WorkingAgent = { key: string; displayName: string; statusText: string; domain: string };

/** A file the student attached to a chat message (already uploaded to storage). */
export type ChatAttachment = {
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
};

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type AgentName =
  | "orchestrator"
  | "query"
  | "suggestion"
  | "alert"
  | "complaint"
  | "knowledge"
  | "action"
  | "case_management"
  | "supervisor";

export type Intent = "query" | "suggestion" | "complaint" | "alert" | "smalltalk" | "unknown";

export type Urgency = "low" | "medium" | "high" | "critical";

export type ActionRisk = "level_0" | "level_1" | "level_2" | "level_3";

export type ResponseType =
  | "answer"
  | "clarification"
  | "action_proposal"
  | "receipt"
  | "handoff"
  | "error";

export type Classification = {
  intent: Intent;
  category: string;
  language: Lang;
  urgency: Urgency;
  sentiment: "positive" | "neutral" | "negative";
  requiredUnitCode: string | null;
  requiredUnitName: string | null;
  requiresAuth: boolean;
  requiresStudentData: boolean;
  actionRequested: boolean;
  requiresHumanEscalation: boolean;
  confidence: number;
};

export type Citation = {
  documentId: string | null;
  sourceTitle: string;
  owningUnit: string | null;
  documentVersion: string | null;
  effectiveDate: string | null;
  citationUrl: string | null;
  confidence: "low" | "medium" | "high" | "unverified";
};

export type ProposedAction = {
  key: string;
  labelEn: string;
  labelAr: string;
  risk: ActionRisk;
  affectedService: string;
  dataShared: string;
  expectedOutcome: string;
  /** What changes for the student once this runs — the real consequence. */
  consequence?: string;
  /** Fee in plain words; "No fee" when the service is free. */
  fee?: string;
  /** Unit that becomes responsible for the record this action creates. */
  responsibleUnit?: string;
  route?: string;
  /** Tool that will run server-side once the student confirms. */
  toolName?: string;
  args?: Record<string, JsonValue>;
  humanApprovalRequired?: boolean;
  /** Whether the student can undo this action afterwards. */
  reversible?: "yes" | "no" | "conditional";
};

export type ActionReceipt = {
  receiptNumber: string;
  referenceNumber: string | null;
  actionType: string;
  responsibleUnit: string | null;
  submittedAt: string;
  expectedFirstResponseAt: string | null;
  expectedResolutionAt: string | null;
  nextStep: string | null;
  trackingUrl: string | null;
  /** Live case state, refreshed whenever an old chat is reopened. */
  caseId?: string | null;
  liveStatus?: string | null;
  assignedStaffName?: string | null;
  outcome?: string | null;
};

/** An issued document shown directly in chat: the exact stored artefact. */
export type IssuedDocumentCard = {
  documentId: string;
  referenceNumber: string;
  titleEn: string;
  titleAr: string;
  language: string;
  issuedAt: string;
  /** Public verification / share link carrying the QR token. */
  verifyUrl: string | null;
  /** Raw QR token; sharing always builds `/verify/<token>` from this. */
  verifyToken?: string | null;
  fileName: string;
  documentHash: string | null;
  /** valid · revoked · expired — refreshed when an old chat is reopened. */
  status?: string | null;
};

/**
 * Career Counselling results shown as a compact card in chat. Every value is
 * produced by the deterministic career engine — never by the model.
 */
export type CareerInsightCard = {
  /** Which career question produced this card. */
  topic: "matches" | "ats" | "cv_review" | "skill_gap" | "interview" | "readiness" | "counsellor";
  cv: {
    hasCv: boolean;
    analysed: boolean;
    fileName: string | null;
    uploadedAt: string | null;
    /** The exact CV the numbers below were computed from. */
    cvId: string | null;
  };
  ats: {
    overall: number;
    band: string;
    strengths: string[];
    improvements: string[];
  } | null;
  matches: {
    roleCode: string;
    title: string;
    fitScore: number;
    readinessScore: number;
    reason: string;
  }[];
  skillGaps: {
    targetRole: string | null;
    strong: string[];
    developing: string[];
    missing: string[];
  } | null;
  /** Deterministic action plan headlines from the career engine. */
  recommendedActions: string[];
  /** Live counselling case, when the student has one open. */
  counsellingRequest: { reference: string; status: string } | null;
  analysisVersion: number;
  calculatedAt: string;

};

/**
 * Live library catalogue results shown as cards in chat. Every field comes
 * straight from the catalogue response — nothing here is model-generated, and
 * availability is never taken from indexed knowledge.
 */
export type LibraryResultsCard = {
  query: string;
  provider: string | null;
  totalMatches: number;
  retrievedAt: string;
  results: {
    id: string;
    title: string;
    authors: string[];
    year: number | null;
    type: string;
    typeLabel: string;
    availability: string;
    availabilityLabel: string;
    library: string | null;
    floor: string | null;
    shelf: string | null;
    callNumber: string | null;
    onlineUrl: string | null;
    catalogueUrl: string | null;
    subjects: string[];
    /** Set when the result was found for a specific registered course. */
    courseCode?: string | null;
  }[];
};

export type DetectedIntent = {
  intent: Intent;
  category: string;
  confidence: number;
  handled: boolean;
};

export type AgentResponse = {
  agent: AgentName;
  classification: Classification;
  answer: string;
  verified: boolean;
  citations: Citation[];
  proposedActions: ProposedAction[];
  messageId: string | null;
  /** Structured agent-loop metadata. */
  conversationId: string | null;
  responseType: ResponseType;
  intents: DetectedIntent[];
  clarifyingQuestion: string | null;
  nextSteps: string[];
  toolsUsed: string[];
  /** Tools that really executed this turn, for the "What Sanadi did" list. */
  activity?: string[];
  confidence: number;
  fallbackUsed: boolean;
  humanHandoff: boolean;
  receipt: ActionReceipt | null;
  /** Set when this turn issued an official document, so chat can show it. */
  issuedDocument?: IssuedDocumentCard | null;
  /** Set when this turn produced Career Counselling results. */
  careerInsight?: CareerInsightCard | null;
  /** Set when this turn returned live library catalogue results. */
  libraryResults?: LibraryResultsCard | null;
  /** Set when this turn showed or updated the result of an existing request. */
  caseResult?: CaseResultCard | null;
  followUp: string | null;
  /** Correlates browser-visible timing with server/model telemetry. */
  traceId?: string;
};

/** Placeholder contract for future Student Information System integrations. */
export interface SisAdapter {
  getEnrollment(studentId: string): Promise<{ available: false; reason: string }>;
  getFinancialBalance(studentId: string): Promise<{ available: false; reason: string }>;
}

/** Decided result of a student's request, shown in chat with follow-up actions. */
export type CaseResultCard = {
  caseId: string;
  reference: string;
  title: string;
  statusLabel: string;
  outcome: string | null;
  decidedAt: string | null;
  unitName: string | null;
  staffName: string | null;
  staffEmail: string | null;
  explanation: string | null;
  nextSteps: string[];
  canObject: boolean;
  reviewState: { kind: string; submittedAt: string; decision: string | null } | null;
  trackingUrl: string;
};
