import { containsSensitiveModelText } from "./modelRouter";

export const PROJECT_CONTEXT_LIMITS = Object.freeze({
  documents: 5,
  documentBytes: 65_536,
  documentCharacters: 4_000,
  goalCharacters: 800,
  criteria: 8,
  criterionCharacters: 300,
});

export type PairPhase = "clarify" | "plan" | "implement" | "verify";

export interface ProjectDocument {
  readonly uri: string;
  readonly label: string;
  readonly text: string;
  readonly truncated?: boolean;
  readonly sensitiveDataDetected?: boolean;
}

export interface ProjectContext {
  readonly rootUri: string | undefined;
  readonly documents: readonly ProjectDocument[];
  readonly suggestedGoal?: string;
  readonly suggestedGoalSource?: string;
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly notices: readonly string[];
}

export interface WorkingAgreement {
  readonly conversationId: string;
  readonly project: ProjectContext;
  readonly goal?: string;
  readonly taskSensitiveDataDetected?: boolean;
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly phase: PairPhase;
  readonly shareWorkspaceContext: boolean;
  readonly decisions: readonly string[];
  readonly recentUserDialogue: readonly { readonly role: "user"; readonly content: string }[];
}

interface DocumentBrief {
  readonly goal: string | undefined;
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
}

type BriefSection = "goal" | "acceptance" | "constraints" | undefined;

export const projectDocumentPath = (
  rootUri: string,
  documentUri: string,
): string | undefined => {
  try {
    const root = new URL(rootUri);
    const document = new URL(documentUri);
    if (
      !["file:", "vscode-remote:"].includes(root.protocol) ||
      root.protocol !== document.protocol ||
      root.host !== document.host ||
      document.search.length > 0 || document.hash.length > 0
    ) {
      return undefined;
    }
    const rootPath = decodeURIComponent(root.pathname).replace(/\/+$/u, "");
    const documentPath = decodeURIComponent(document.pathname);
    const comparableRoot = /^\/[a-z]:/iu.test(rootPath) ? rootPath.toLowerCase() : rootPath;
    const comparableDocument = /^\/[a-z]:/iu.test(rootPath) ? documentPath.toLowerCase() : documentPath;
    if (!comparableDocument.startsWith(`${comparableRoot}/`)) {
      return undefined;
    }
    const relative = documentPath.slice(rootPath.length + 1);
    const segments = relative.split("/");
    if (
      relative.includes("\\") ||
      segments.some((segment) => segment.length === 0 || segment.startsWith(".") || segment.toLowerCase() === "node_modules") ||
      !(/^(?:readme|agents|working-agreement)\.md$/iu.test(relative) || /^docs\/.+\.md$/iu.test(relative))
    ) {
      return undefined;
    }
    return relative;
  } catch {
    return undefined;
  }
};

export const compareProjectDocuments = (
  left: Pick<ProjectDocument, "label">,
  right: Pick<ProjectDocument, "label">,
): number => documentRank(left.label) - documentRank(right.label) || right.label.localeCompare(left.label);

const documentRank = (label: string): number => {
  if (/(?:^|\/)(?:plans?|briefs?)(?:\/|\.)|working-agreement/iu.test(label)) {
    return 0;
  }
  if (/^readme\.md$/iu.test(label)) {
    return 1;
  }
  return /(?:^|\/)specs?\//iu.test(label) ? 2 : 3;
};

export const buildProjectContext = (
  rootUri: string | undefined,
  documents: readonly ProjectDocument[],
  notices: readonly string[] = [],
): ProjectContext => {
  const eligible = documents
    .filter((document) => rootUri !== undefined && projectDocumentPath(rootUri, document.uri) === document.label);
  const sensitiveDataDetected = eligible.some((document) =>
    document.sensitiveDataDetected === true ||
    containsSensitiveModelText(document.label) ||
    containsSensitiveModelText(document.text),
  );
  const selected = eligible
    .sort(compareProjectDocuments)
    .slice(0, PROJECT_CONTEXT_LIMITS.documents);
  const briefs = selected.map((document) => ({ document, brief: parseBrief(document.text) }));
  const candidate = briefs.find(({ brief }) => brief.goal !== undefined);
  const retained = selected.map((document) => Object.freeze({
    ...document,
    text: document.text.slice(0, PROJECT_CONTEXT_LIMITS.documentCharacters),
    truncated: document.truncated === true || document.text.length > PROJECT_CONTEXT_LIMITS.documentCharacters,
    ...(sensitiveDataDetected ? { sensitiveDataDetected: true } : {}),
  }));
  return Object.freeze({
    rootUri,
    documents: Object.freeze(retained),
    ...(candidate?.brief.goal === undefined ? {} : {
      suggestedGoal: candidate.brief.goal,
      suggestedGoalSource: candidate.document.label,
    }),
    acceptanceCriteria: Object.freeze([...(candidate?.brief.acceptanceCriteria ?? [])]),
    constraints: Object.freeze([...(candidate?.brief.constraints ?? [])]),
    notices: Object.freeze([...notices].slice(0, 8)),
  });
};

export const createWorkingAgreement = (
  project: ProjectContext,
  conversationId: string,
): WorkingAgreement => Object.freeze({
  conversationId,
  project,
  acceptanceCriteria: Object.freeze([]),
  constraints: Object.freeze([]),
  phase: "clarify",
  shareWorkspaceContext: false,
  decisions: Object.freeze([]),
  recentUserDialogue: Object.freeze([]),
});

export const confirmWorkingGoal = (
  working: WorkingAgreement,
  input: string,
  conversationId: string,
): WorkingAgreement => {
  if (input.trim().length === 0 || input.length > 4_096) {
    throw new Error("Provide a goal, optionally with acceptance criteria and constraints, within 4,096 characters.");
  }
  const taskSensitiveDataDetected = containsSensitiveModelText(input);
  const brief = parseBrief(input);
  const goal = brief.goal ?? input.trim();
  if (goal.length > PROJECT_CONTEXT_LIMITS.goalCharacters) {
    throw new Error("Keep the goal within 800 characters; put criteria and constraints under separate headings.");
  }
  return Object.freeze({
    ...working,
    conversationId,
    goal,
    taskSensitiveDataDetected,
    acceptanceCriteria: Object.freeze([...brief.acceptanceCriteria]),
    constraints: Object.freeze([...brief.constraints]),
    phase: "plan",
    decisions: Object.freeze([]),
    recentUserDialogue: Object.freeze([]),
  });
};

export const createWorkingAgreementDraft = (working: WorkingAgreement): string => {
  const goal = working.goal ?? working.project.suggestedGoal;
  const criteria = working.acceptanceCriteria.length > 0 ? working.acceptanceCriteria : working.project.acceptanceCriteria;
  const constraints = working.constraints.length > 0 ? working.constraints : working.project.constraints;
  return [
    "# Pair working agreement",
    "",
    "Draft for developer review. Document-derived statements are proposals, not confirmed requirements or verified results.",
    "",
    "## Goal",
    goal ?? "Which user problem should this development cycle solve?",
    "",
    "## Acceptance criteria",
    ...(criteria.length > 0 ? criteria.map((criterion) => `- [ ] ${criterion}`) : ["- [ ] Define an observable behavior that demonstrates the goal is met.", "- [ ] Define the important failure case and how to test it."]),
    "",
    "## Constraints",
    ...(constraints.length > 0 ? constraints.map((constraint) => `- ${constraint}`) : ["- Agree on compatibility requirements and what is out of scope."]),
    "",
    "## Next step",
    "Agree on one small behavior and its first test before implementing it.",
    "",
    "## Verification and decisions",
    ...working.decisions.map((decision) => `- ${decision}`),
    "Record the actual command, observed result, remaining criteria, and the reason for important choices. No tests have been run by this draft.",
    "",
    "## Sources to check",
    ...working.project.documents.map((document) => `- ${document.label}${document.truncated ? " (partial excerpt)" : ""}`),
    "",
  ].join("\n");
};

const sectionFor = (heading: string): BriefSection => {
  const normalized = heading.replace(/\*|_/gu, "").replace(/^\d+[.)]?\s*/u, "").replace(/[:：]\s*$/u, "").trim().toLowerCase();
  if (/^(?:(?:product|current|development|session) )?(?:goal|objective)s?$|^(?:제품 |개발 |이번 |작업 )?목표$/u.test(normalized)) {
    return "goal";
  }
  if (/^(?:acceptance|success|completion) criteria$|^definition of done$|^(?:완료 조건|완료 기준|인수 조건|수용 기준|성공 기준)$/u.test(normalized)) {
    return "acceptance";
  }
  if (/^(?:constraints|non-goals|out of scope)$|^(?:제약|제약 사항|범위 제외|비목표)$/u.test(normalized)) {
    return "constraints";
  }
  return undefined;
};

const parseBrief = (text: string): DocumentBrief => {
  let section: BriefSection;
  let fence: string | undefined;
  const goals: string[] = [];
  const acceptanceCriteria: string[] = [];
  const constraints: string[] = [];
  for (const rawLine of text.slice(0, PROJECT_CONTEXT_LIMITS.documentBytes).split(/\r?\n/u)) {
    const line = rawLine.trim();
    const fenceMatch = /^(?:`{3,}|~{3,})/u.exec(line);
    if (fenceMatch !== null) {
      fence = fence === undefined ? fenceMatch[0][0] : fenceMatch[0][0] === fence ? undefined : fence;
      continue;
    }
    if (fence !== undefined || line.length === 0) {
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/u.exec(line);
    if (heading !== null) {
      section = sectionFor(heading[1] ?? "");
      continue;
    }
    const labelled = /^([^:：]{1,40})[:：]\s*(.+)$/u.exec(line.replace(/\*\*/gu, ""));
    const labelledSection = labelled === null ? undefined : sectionFor(labelled[1] ?? "");
    if (labelledSection !== undefined) {
      section = labelledSection;
    }
    const value = (labelledSection === undefined ? line : labelled?.[2] ?? "")
      .replace(/^(?:[-*+]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s*)?/u, "")
      .replace(/\s+/gu, " ").trim();
    if (section === "goal" && goals.length === 0) {
      goals.push(value.slice(0, PROJECT_CONTEXT_LIMITS.goalCharacters));
    } else if (section === "acceptance" && acceptanceCriteria.length < PROJECT_CONTEXT_LIMITS.criteria) {
      acceptanceCriteria.push(value.slice(0, PROJECT_CONTEXT_LIMITS.criterionCharacters));
    } else if (section === "constraints" && constraints.length < PROJECT_CONTEXT_LIMITS.criteria) {
      constraints.push(value.slice(0, PROJECT_CONTEXT_LIMITS.criterionCharacters));
    }
  }
  return { goal: goals[0], acceptanceCriteria, constraints };
};
