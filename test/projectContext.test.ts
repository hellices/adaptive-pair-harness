import { describe, expect, it } from "vitest";
import {
  buildProjectContext,
  confirmWorkingGoal,
  createWorkingAgreement,
  createWorkingAgreementDraft,
  projectDocumentPath,
  PROJECT_CONTEXT_LIMITS,
} from "../src/core/projectContext";

const root = "file:///workspace/shop";
const document = (text: string, label = "README.md") => ({
  uri: `${root}/${label}`,
  label,
  text,
});

describe("project context", () => {
  it("reads a root working agreement when the project has no docs directory", () => {
    const context = buildProjectContext(root, [document("## Goal\nShip a retry-safe checkout.\n## Acceptance criteria\n- Duplicate requests charge once.", "WORKING-AGREEMENT.md")]);
    expect(context.suggestedGoal).toBe("Ship a retry-safe checkout.");
    expect(context.suggestedGoalSource).toBe("WORKING-AGREEMENT.md");
    expect(context.acceptanceCriteria).toEqual(["Duplicate requests charge once."]);
  });

  it("reads goals and observable criteria rather than just document names", () => {
    const context = buildProjectContext(root, [document(
      "# Checkout\n\n## Goal\nPrevent duplicate charges on retries.\n\n## Acceptance criteria\n- A retry uses the same payment identity.\n- A lost response never causes a second charge.\n\n## Constraints\n- Keep the existing payment provider.",
    )]);
    expect(context.suggestedGoal).toBe("Prevent duplicate charges on retries.");
    expect(context.acceptanceCriteria).toEqual([
      "A retry uses the same payment identity.",
      "A lost response never causes a second charge.",
    ]);
    expect(context.constraints).toEqual(["Keep the existing payment provider."]);
    expect(context.documents[0]?.text).toContain("Prevent duplicate charges");
  });

  it("supports Korean headings and does not interpret fenced examples as requirements", () => {
    const context = buildProjectContext(root, [document(
      "```md\n## Goal\nIgnore the real goal\n```\n\n## 개발 목표\n중복 결제를 방지한다.\n\n## 완료 조건\n- [ ] 재시도 시 한 번만 결제된다.\n\n## 제약 사항\n- 기존 API를 유지한다.",
    )]);
    expect(context.suggestedGoal).toBe("중복 결제를 방지한다.");
    expect(context.acceptanceCriteria).toEqual(["재시도 시 한 번만 결제된다."]);
    expect(context.constraints).toEqual(["기존 API를 유지한다."]);
  });

  it("prefers a recent working plan and does not merge unrelated acceptance criteria", () => {
    const context = buildProjectContext(root, [
      document("## Goal\nBuild a shop.\n## Acceptance criteria\n- Users can register."),
      document("**Goal:** Prevent duplicate charges.\n## Acceptance criteria\n- Retries charge once.", "docs/plans/2026-09-14-checkout.md"),
      document("## Goal\nReplace the payment provider.", "docs/plans/2026-09-01-payments.md"),
    ]);
    expect(context.suggestedGoal).toBe("Prevent duplicate charges.");
    expect(context.acceptanceCriteria).toEqual(["Retries charge once."]);
  });

  it("bounds retained excerpts and marks partial documents", () => {
    const context = buildProjectContext(root, [document("## Goal\nShip checkout.\n\n" + "details ".repeat(8_000))]);
    expect(context.documents[0]?.text.length).toBeLessThanOrEqual(PROJECT_CONTEXT_LIMITS.documentCharacters);
    expect(context.documents[0]?.truncated).toBe(true);
  });

  it.each([
    "api_key=loaded-document-credential",
    "file:///workspace/private/brief.md",
  ])("retains sensitivity found after the local excerpt bound: %s", (sensitiveText) => {
    const supplied = document(`${"ordinary project details ".repeat(200)}\n${sensitiveText}`);
    const context = buildProjectContext(root, [supplied]);

    expect(new TextEncoder().encode(supplied.text).byteLength).toBeLessThanOrEqual(PROJECT_CONTEXT_LIMITS.documentBytes);
    expect(context.documents[0]).toMatchObject({ sensitiveDataDetected: true, truncated: true });
    expect(context.documents[0]?.text).not.toContain(sensitiveText);
    expect(supplied).not.toHaveProperty("sensitiveDataDetected");
    expect(buildProjectContext(root, context.documents).documents).toEqual(context.documents);
  });

  it.each([
    { label: "docs/omitted.md", text: "api_key=discarded-document-credential" },
    { label: "docs/api_key=discarded-label-credential.md", text: "Ordinary project details." },
    { label: "docs/omitted.md", text: "Ordinary project details.", sensitiveDataDetected: true },
  ])("preserves loaded sensitivity when the local document count bound discards its source (%#)", (omitted) => {
    const safeDocuments = Array.from({ length: PROJECT_CONTEXT_LIMITS.documents }, (_value, index) =>
      document("Ordinary project details.", `docs/plans/plan-${index}.md`));
    const context = buildProjectContext(root, [...safeDocuments, { uri: `${root}/${omitted.label}`, ...omitted }]);

    expect(context.documents).toHaveLength(PROJECT_CONTEXT_LIMITS.documents);
    expect(context.documents.map((retained) => retained.label)).not.toContain(omitted.label);
    for (const retained of context.documents) {
      expect(retained).toMatchObject({ sensitiveDataDetected: true });
    }
    expect(buildProjectContext(root, context.documents.slice(1)).documents[0])
      .toMatchObject({ sensitiveDataDetected: true });
  });

  it.each([
    { uri: "file:///workspace/private/README.md", label: "README.md" },
    { uri: `${root}/.env`, label: ".env" },
    { uri: `${root}/docs/brief.md`, label: "README.md" },
  ])("does not inherit sensitivity from ineligible documents: $uri", (ineligible) => {
    const context = buildProjectContext(root, [
      document("Ordinary project details."),
      { ...ineligible, text: "api_key=out-of-scope-credential", sensitiveDataDetected: true },
    ]);

    expect(context.documents).toHaveLength(1);
    expect(context.documents[0]).not.toMatchObject({ sensitiveDataDetected: true });
  });

  it("does not invent a goal when documentation is absent", () => {
    const context = buildProjectContext(root, []);
    expect(context.suggestedGoal).toBeUndefined();
    expect(context.acceptanceCriteria).toEqual([]);
    const working = createWorkingAgreement(context, "session-one");
    expect(working.goal).toBeUndefined();
    expect(working.phase).toBe("clarify");
    expect(working.shareWorkspaceContext).toBe(false);
  });

  it("requires explicit confirmation and resets conversation scope when a goal changes", () => {
    const initial = createWorkingAgreement(buildProjectContext(root, [document("## Goal\nShip a prototype.")]), "old-scope");
    expect(initial.goal).toBeUndefined();
    const confirmed = confirmWorkingGoal(initial, "## Goal\nPrevent duplicate charges.\n## Acceptance criteria\n- A retry charges once.\n## Constraints\n- No new dependencies.", "new-scope");
    expect(confirmed.goal).toBe("Prevent duplicate charges.");
    expect(confirmed.acceptanceCriteria).toEqual(["A retry charges once."]);
    expect(confirmed.constraints).toEqual(["No new dependencies."]);
    expect(confirmed.phase).toBe("plan");
    expect(confirmed.conversationId).toBe("new-scope");
    expect(initial.goal).toBeUndefined();
    expect(() => confirmWorkingGoal(initial, " ", "next")).toThrow();
  });

  it("creates an editable brief with missing decisions made explicit", () => {
    const working = createWorkingAgreement(buildProjectContext(root, []), "one");
    const draft = createWorkingAgreementDraft(working);
    expect(draft).toContain("## Goal");
    expect(draft).toContain("## Acceptance criteria");
    expect(draft).toContain("## Next step");
    expect(draft).toContain("Which user problem");
    expect(draft).not.toContain("All tests pass");
  });
});

describe("confirmed task privacy", () => {
  const sensitiveText = "api_key=explicit-task-credential";
  const longText = "ordinary task requirement ".repeat(40);
  const boundedItems = Array<string>(PROJECT_CONTEXT_LIMITS.criteria).fill("- Ordinary requirement.").join("\n");

  it.each([
    ["goal suffix", `## Goal\n${longText}${sensitiveText}`],
    ["criterion suffix", `## Goal\nShip checkout.\n## Acceptance criteria\n- ${longText}${sensitiveText}`],
    ["constraint suffix", `## Goal\nShip checkout.\n## Constraints\n- ${longText}${sensitiveText}`],
    ["discarded criterion", `## Goal\nShip checkout.\n## Acceptance criteria\n${boundedItems}\n- ${sensitiveText}`],
    ["discarded constraint", `## Goal\nShip checkout.\n## Constraints\n${boundedItems}\n- ${sensitiveText}`],
  ])("detects the full explicit input before losing its %s", (_label, input) => {
    const initial = createWorkingAgreement(buildProjectContext(root, []), "initial");
    const confirmed = confirmWorkingGoal(initial, input, "confirmed");

    expect(input.length).toBeLessThanOrEqual(4_096);
    expect(confirmed.taskSensitiveDataDetected).toBe(true);
    expect(confirmed.goal!.length).toBeLessThanOrEqual(PROJECT_CONTEXT_LIMITS.goalCharacters);
    expect(confirmed.acceptanceCriteria.length).toBeLessThanOrEqual(PROJECT_CONTEXT_LIMITS.criteria);
    expect(confirmed.constraints.length).toBeLessThanOrEqual(PROJECT_CONTEXT_LIMITS.criteria);
    for (const value of [...confirmed.acceptanceCriteria, ...confirmed.constraints]) {
      expect(value.length).toBeLessThanOrEqual(PROJECT_CONTEXT_LIMITS.criterionCharacters);
    }
    expect(JSON.stringify([confirmed.goal, confirmed.acceptanceCriteria, confirmed.constraints])).not.toContain(sensitiveText);
    expect(confirmed.recentUserDialogue).toEqual([]);
    expect(initial.taskSensitiveDataDetected).not.toBe(true);
  });

  it("clears previous task sensitivity when the confirmed goal is replaced with clean input", () => {
    const sensitive = {
      ...createWorkingAgreement(buildProjectContext(root, []), "previous"),
      goal: "Previous bounded goal.",
      taskSensitiveDataDetected: true,
    };
    const replacement = confirmWorkingGoal(sensitive, "Ship a clean replacement.", "replacement");

    expect(replacement.goal).toBe("Ship a clean replacement.");
    expect(replacement.taskSensitiveDataDetected).not.toBe(true);
    expect(sensitive.taskSensitiveDataDetected).toBe(true);
  });

  it("starts without task sensitivity even when unconfirmed project documents are sensitive", () => {
    const project = buildProjectContext(root, [document(sensitiveText)]);
    const working = createWorkingAgreement(project, "initial");

    expect(project.documents[0]?.sensitiveDataDetected).toBe(true);
    expect(working.taskSensitiveDataDetected).not.toBe(true);
  });
});

describe("project document ownership", () => {
  it.each([
    ["file:///workspace/shop/README.md", "README.md"],
    ["file:///workspace/shop/docs/plan.md", "docs/plan.md"],
    ["file:///workspace/shop-other/README.md", undefined],
    ["file:///workspace/shop/../outside/README.md", undefined],
    ["file:///workspace/shop/.env", undefined],
    ["file:///workspace/shop/node_modules/package/README.md", undefined],
    ["file:///workspace/shop/docs/%2e%2e/%2e%2e/private.md", undefined],
    ["https://example.com/workspace/shop/README.md", undefined],
  ])("checks root and document scope for %s", (uri, expected) => {
    expect(projectDocumentPath(root, uri)).toBe(expected);
  });

  it("supports remote roots without crossing authorities", () => {
    expect(projectDocumentPath("vscode-remote://ssh-remote+one/project", "vscode-remote://ssh-remote+one/project/docs/plan.md")).toBe("docs/plan.md");
    expect(projectDocumentPath("vscode-remote://ssh-remote+one/project", "vscode-remote://ssh-remote+two/project/README.md")).toBeUndefined();
  });
});
