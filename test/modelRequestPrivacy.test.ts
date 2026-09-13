import { describe, expect, it } from "vitest";
import {
  buildOpenAICompatiblePromptPayload,
  prepareRemoteModelRequest,
} from "../src/core/modelRouter";
import {
  PairSharedContext,
  buildPairChatPlan,
} from "../src/vscode/pairChatParticipant";
import { buildCopilotPrompt } from "../src/vscode/vsCodeLanguageModelProvider";
import type { ModelRequest } from "../src/core/modelRouter";

const requestContaining = (text: string): ModelRequest => ({
  goal: text,
  interactionStyle: "ask-first",
  evidence: {
    id: "dependency:privacy-regression",
    kind: "new-dependency",
    severity: "warning",
    title: "Credential-like text introduced",
    detail: text,
    source: "typescript-semantic-analyzer",
    confidence: 0.94,
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 10 },
    },
    references: [],
  },
});

const sensitiveKeyVariants = [
  "client_secret",
  "clientSecret",
  "client-secret",
  "client.secret",
  "api_key",
  "api.key",
  "access_key",
  "accessKeyId",
  "aws_access_key_id",
  "secretAccessKey",
  "aws-secret-access-key",
  "accessToken",
  "dbCredential",
  "privateKey",
  "password",
  "passwd",
  "requestSignature",
  "X-Amz-Signature",
  "token",
  "secret",
  "database_password",
  "userPasswd",
  "auth_token",
  "signingSecret",
  "cookie",
  "set_cookie",
  "setCookie",
] as const;

const localOnlyNotice = "[REDACTED] Sensitive content kept local.";

const automaticEvidenceSummaries = [
  [
    "new-dependency",
    "Dependency change detected",
    "A new module dependency was detected at the evidence range.",
    "adaptive-pair-semantic-analysis",
  ],
  [
    "public-api-change",
    "Public API change detected",
    "A public API signature change was detected at the evidence range.",
    "adaptive-pair-semantic-analysis",
  ],
  [
    "complexity-growth",
    "Complexity growth detected",
    "Control-flow complexity growth was detected at the evidence range.",
    "adaptive-pair-semantic-analysis",
  ],
  [
    "diagnostic",
    "Editor diagnostic detected",
    "VS Code reported a diagnostic at the evidence range.",
    "vscode-diagnostics",
  ],
  [
    "external-harness",
    "External harness signal detected",
    "An external harness reported evidence at the evidence range.",
    "adaptive-pair-external-harness",
  ],
] as const;

describe("remote model request privacy", () => {
  it.each(automaticEvidenceSummaries)(
    "projects %s evidence from a fixed whitelist and drops all analyzer text",
    (kind, title, detail, source) => {
      const malicious = {
        id: `raw-id-${kind}-file:///Users/alice/private.ts`,
        title: `arbitrary-title-${kind}-do-not-forward`,
        detail: `arbitrary-detail-${kind}-do-not-forward`,
        source: `arbitrary-source-${kind}-do-not-forward`,
        references: [
          `arbitrary-reference-${kind}-do-not-forward`,
          `arbitrary-second-reference-${kind}-do-not-forward`,
        ],
      };
      const request: ModelRequest = {
        goal: "Ask about the detected evidence.",
        interactionStyle: "ask-first",
        evidence: {
          ...malicious,
          kind,
          severity: "warning",
          confidence: 0.73,
          range: {
            start: { line: 4, character: 2 },
            end: { line: 7, character: 9 },
          },
        },
      };

      const prepared = prepareRemoteModelRequest(request);
      expect(prepared.sensitiveDataDetected).toBe(false);
      expect(prepared.request.evidence).toMatchObject({
        id: "remote-evidence",
        kind,
        title,
        detail,
        source,
        references: [],
        range: request.evidence.range,
      });

      for (const payload of [
        JSON.stringify(buildOpenAICompatiblePromptPayload(request)),
        buildCopilotPrompt(request),
      ]) {
        expect(payload).not.toContain("Evidence ID");
        expect(payload).not.toContain("remote-evidence");
        for (const rawValue of [
          malicious.id,
          malicious.title,
          malicious.detail,
          malicious.source,
          ...malicious.references,
        ]) {
          expect(payload).not.toContain(rawValue);
        }
      }
    },
  );

  it.each([
    ["file directory URI", "file:///Users/alice/"],
    [
      "VS Code remote directory URI",
      "vscode-remote://host/home/alice/",
    ],
    ["POSIX path with spaces", "/Users/alice/my project"],
    [
      "extensionless Windows path with spaces",
      "C:\\Users\\Alice Smith\\My Project",
    ],
    [
      "extensionless UNC path with spaces",
      "\\\\server\\share\\Alice Smith\\My Project",
    ],
  ])("keeps a Chat prompt containing %s local as one field", (_label, prompt) => {
    const prepared = prepareRemoteModelRequest({
      goal: "Explain the current evidence.",
      interactionStyle: "ask-first",
      evidence: {
        id: "dependency:safe",
        kind: "new-dependency",
        severity: "warning",
        title: "New dependency introduced",
        detail: "A dependency changed.",
        source: "typescript-semantic-analyzer",
        confidence: 0.9,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        references: [],
      },
      context: { userPrompt: prompt },
    });

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(prepared.request.context?.userPrompt).toBe(localOnlyNotice);
  });

  it.each([
    [
      "a single quote inside a double-quoted value",
      `password="alpha's \\"quoted\\" secret"`,
    ],
    [
      "a double quote inside a single-quoted value",
      `password='alpha"s \\'quoted\\' secret'`,
    ],
  ])("keeps an explicit Chat prompt with %s local", (_label, userPrompt) => {
    const prepared = prepareRemoteModelRequest({
      goal: "Explain the current evidence.",
      interactionStyle: "ask-first",
      evidence: {
        id: "dependency:safe",
        kind: "new-dependency",
        severity: "warning",
        title: "New dependency introduced",
        detail: "A dependency changed.",
        source: "typescript-semantic-analyzer",
        confidence: 0.9,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        references: [],
      },
      context: { userPrompt },
    });

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(prepared.request.context?.userPrompt).toBe(localOnlyNotice);
    expect(JSON.stringify(prepared.request)).not.toContain("alpha");
  });

  it.each([
    ["a multiline double-quoted assignment", `password = "first\nsecond"`],
    ["a multiline single-quoted assignment", `password = 'first\nsecond'`],
    [
      "escaped double quotes followed by a newline",
      `password = "first\\"\nsecond"`,
    ],
    [
      "escaped single quotes followed by a newline",
      `password = 'first\\'\nsecond'`,
    ],
  ])("keeps %s entirely local", (_label, userPrompt) => {
    const request: ModelRequest = {
      ...requestContaining("Explain the current evidence."),
      context: { userPrompt },
    };
    const prepared = prepareRemoteModelRequest(request);

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(prepared.request.context?.userPrompt).toBe(localOnlyNotice);
    for (const payload of [
      JSON.stringify(prepared.request),
      JSON.stringify(buildOpenAICompatiblePromptPayload(request)),
      buildCopilotPrompt(request),
    ]) {
      expect(payload).not.toContain("password");
      expect(payload).not.toContain("second");
    }
  });

  it.each([
    ["custom scheme", "custom-file:///docs"],
    ["closing markup", "</section>"],
    ["ordinary package names", "Use @scope/package and lodash/fp."],
    [
      "normal prose",
      "Please compare the two normal options before proceeding.",
    ],
  ])("does not classify %s as a local resource", (_label, prompt) => {
    const prepared = prepareRemoteModelRequest({
      goal: "Explain the current evidence.",
      interactionStyle: "ask-first",
      evidence: {
        id: "dependency:safe",
        kind: "new-dependency",
        severity: "warning",
        title: "New dependency introduced",
        detail: "A dependency changed.",
        source: "typescript-semantic-analyzer",
        confidence: 0.9,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        references: [],
      },
      context: { userPrompt: prompt },
    });

    expect(prepared.sensitiveDataDetected).toBe(false);
    expect(prepared.request.context?.userPrompt).toBe(prompt);
  });

  it("removes unbounded third-party diagnostic text and preserves fixed safe metadata", () => {
    const secret = "sk-do-not-forward-this-secret";
    const sourceSnippet = "const privateToken = process.env.PRODUCTION_TOKEN;";
    const unboundedCode = `TS${"9".repeat(500)}`;
    const request: ModelRequest = {
      goal: "Explain the current diagnostic.",
      interactionStyle: "ask-first",
      evidence: {
        id: "diagnostic:file:///workspace/private.ts:10:2",
        kind: "diagnostic",
        severity: "error",
        title: "Editor diagnostic",
        detail: `${sourceSnippet} ${secret} ${"long-message ".repeat(200)}`,
        source: "typescript",
        confidence: 0.97,
        range: {
          start: { line: 10, character: 2 },
          end: { line: 10, character: 22 },
        },
        references: ["TS2322", unboundedCode],
      },
    };

    for (const payload of [
      JSON.stringify(buildOpenAICompatiblePromptPayload(request)),
      buildCopilotPrompt(request),
    ]) {
      expect(payload).not.toContain(secret);
      expect(payload).not.toContain(sourceSnippet);
      expect(payload).not.toContain(unboundedCode);
      expect(payload.length).toBeLessThan(2_000);
      expect(payload).toContain("vscode-diagnostics");
      expect(payload).toContain("Diagnostic code: none");
      expect(payload).toContain("error");
      expect(payload).toContain("10:2-10:22");
      expect(payload).toContain(
        "VS Code reported a diagnostic at the evidence range.",
      );
    }
  });

  it("serializes bounded explicit Chat prompt and symbol fields without source text", () => {
    const request: ModelRequest = {
      goal: "Trace the current evidence.",
      interactionStyle: "ask-first",
      evidence: {
        id: "complexity:handleRequest",
        kind: "complexity-growth",
        severity: "warning",
        title: "Control-flow complexity increased",
        detail: "Added two branch points.",
        source: "typescript-semantic-analyzer",
        confidence: 0.89,
        range: {
          start: { line: 10, character: 2 },
          end: { line: 20, character: 3 },
        },
        references: ["handleRequest"],
      },
      context: {
        userPrompt: `Why is this risky? ${"p".repeat(1_000)}`,
        symbol: {
          name: "handleRequest",
          kind: "Function",
          range: {
            start: { line: 10, character: 2 },
            end: { line: 20, character: 3 },
          },
        },
      },
    };

    for (const payload of [
      JSON.stringify(buildOpenAICompatiblePromptPayload(request)),
      buildCopilotPrompt(request),
    ]) {
      expect(payload).toContain("User prompt: Why is this risky?");
      expect(payload).toContain("Current symbol: handleRequest (Function)");
      expect(payload).toContain("Symbol range: 10:2-20:3");
      expect(payload).not.toContain("p".repeat(501));
      expect(payload).not.toContain("selectionText");
      expect(payload).not.toContain("sourceText");
    }
  });

  it("never promotes tainted diagnostic text or the latest local question into remote Chat fields", () => {
    const secret = "prod-secret-should-never-leave";
    const sourceCode = "const adminToken = readSecretFromDisk();";
    const context = new PairSharedContext({
      enabled: true,
      active: true,
      goal: "Navigate with evidence-backed questions.",
      role: "navigator",
      provider: "vscode-copilot",
      remainingCalls: 4,
      remainingInputTokens: 6_000,
      controlNotice: undefined,
      configurationWarning: undefined,
    });
    context.publishEvidence({
      uri: "file:///workspace/private.ts",
      evidence: {
        id: "diagnostic:file:///workspace/private.ts:3:1",
        kind: "diagnostic",
        severity: "error",
        title: "Editor diagnostic",
        detail: `${sourceCode} // ${secret}`,
        source: "typescript",
        confidence: 0.97,
        range: {
          start: { line: 3, character: 1 },
          end: { line: 3, character: 12 },
        },
        references: ["TS2322"],
      },
      question: `Why does ${sourceCode} contain ${secret}?`,
    });

    const plan = buildPairChatPlan("why", context.snapshot(), {
      prompt: "Please explain this diagnostic.",
    });
    if (plan.kind !== "generate") {
      throw new Error("Expected generation plan.");
    }
    expect(plan.evidence.detail).toContain(sourceCode);
    const serialized = JSON.stringify(
      prepareRemoteModelRequest({
        goal: plan.goal,
        evidence: plan.evidence,
        interactionStyle: "ask-first",
        context: plan.context,
        purpose: plan.purpose,
      }).request,
    );
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(sourceCode);
    expect(serialized).toContain(
      "VS Code reported a diagnostic at the evidence range.",
    );
    expect(serialized).toContain("Please explain this diagnostic.");
  });

  it("centrally redacts credentials from every semantic and Chat text field", () => {
    const apiKey = "sk-1234567890abcdefghijklmnop";
    const bearer = "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature";
    const userInfoUrl =
      "https://alice:password123@example.test/path?token=query-secret&safe=value";
    const longSecret = "AbCdEf0123456789_".repeat(5);
    const request: ModelRequest = {
      goal: `Explain api_key=${apiKey}`,
      interactionStyle: "ask-first",
      evidence: {
        id: `semantic:${apiKey}`,
        kind: "new-dependency",
        severity: "warning",
        title: `Imported ${bearer}`,
        detail: `Dependency URL ${userInfoUrl}`,
        source: `credential=${longSecret}`,
        confidence: 0.94,
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 8 },
        },
        references: [
          `https://example.test/pkg?access_token=${apiKey}`,
          longSecret,
        ],
      },
      context: {
        userPrompt: `password: ${longSecret}`,
        symbol: {
          name: `handler_${apiKey}`,
          kind: `Function ${bearer}`,
          range: {
            start: { line: 1, character: 0 },
            end: { line: 3, character: 1 },
          },
        },
      },
    };

    const prepared = prepareRemoteModelRequest(request);
    const serialized = JSON.stringify(prepared.request);

    expect(prepared.sensitiveDataDetected).toBe(true);
    for (const secret of [
      apiKey,
      bearer,
      "alice",
      "password123",
      "query-secret",
      longSecret,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("[REDACTED]");
  });

  it("marks every unsafe request field local-only while evidence uses its fixed projection", () => {
    const repeatedPath = "/Users/alice/private/workspace/src/shared.ts";
    const prepared = prepareRemoteModelRequest({
      goal: `Review ${repeatedPath}`,
      interactionStyle: "ask-first",
      evidence: {
        id: "file:///Users/alice/private/workspace/src/evidence.ts",
        kind: "new-dependency",
        severity: "warning",
        title:
          "vscode-remote://ssh-remote+production/home/alice/private/title.ts",
        detail:
          'import database from "/opt/company/Private Data/database.ts";',
        source: "C:\\Users\\Alice\\private\\source.ts",
        confidence: 0.94,
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 8 },
        },
        references: [
          repeatedPath,
          "D:/Projects/private/reference.ts",
          "C:\\Users\\Alice Smith\\private\\reference.ts",
        ],
      },
      context: {
        userPrompt:
          "Inspect file:///home/alice/private/prompt.ts without exposing it.",
        symbol: {
          name: "/srv/private/symbol.ts",
          kind: "C:\\private\\SymbolKind",
          range: {
            start: { line: 1, character: 0 },
            end: { line: 3, character: 1 },
          },
        },
      },
    });
    const serialized = JSON.stringify(prepared.request);

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(prepared.request.goal).toBe(localOnlyNotice);
    expect(prepared.request.context).toMatchObject({
      userPrompt: localOnlyNotice,
      symbol: {
        name: localOnlyNotice,
        kind: localOnlyNotice,
      },
    });
    expect(prepared.request.evidence).toMatchObject({
      title: "Dependency change detected",
      source: "adaptive-pair-semantic-analysis",
      references: [],
    });
    for (const localFragment of [
      "file://",
      "vscode-remote://",
      "/Users/alice",
      "/home/alice",
      "/opt/company",
      " Data/database.ts",
      "/srv/private",
      "C:\\\\Users",
      "C:\\\\private",
      "D:/Projects",
      " Smith\\\\private",
      "ssh-remote+production",
    ]) {
      expect(serialized).not.toContain(localFragment);
    }
  });

  it.each([
    [
      "a comma-delimited POSIX path",
      "foo,/Users/alice/private.ts",
      /^foo,\[local-resource:[a-f0-9]{16}\]$/u,
    ],
    [
      "an unquoted POSIX path with spaces",
      "Review /Users/alice/My Project/private.ts",
      /^Review \[local-resource:[a-f0-9]{16}\]$/u,
    ],
    [
      "an unquoted POSIX filename with multiple spaces",
      "Review /Users/alice/My Private File.ts",
      /^Review \[local-resource:[a-f0-9]{16}\]$/u,
    ],
    [
      "a lowercase unquoted POSIX filename with multiple spaces",
      "Review /Users/alice/my private file.ts",
      /^Review \[local-resource:[a-f0-9]{16}\]$/u,
    ],
    [
      "a comma-delimited Windows path with spaces",
      "foo,C:\\Users\\Alice Smith\\Project\\private.ts",
      /^foo,\[local-resource:[a-f0-9]{16}\]$/u,
    ],
    [
      "a comma-delimited file URI with spaces",
      "foo,file:///Users/alice/My Project/private.ts",
      /^foo,\[local-resource:[a-f0-9]{16}\]$/u,
    ],
    [
      "a comma-delimited vscode-remote URI with spaces",
      "foo,vscode-remote://ssh-remote+host/home/alice/My Project/private.ts",
      /^foo,\[local-resource:[a-f0-9]{16}\]$/u,
    ],
  ])("marks the whole field containing %s as local-only", (_label, text) => {
    const prepared = prepareRemoteModelRequest(requestContaining(text));

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(prepared.request.goal).toBe(localOnlyNotice);
  });

  it("preserves ordinary prose, URLs, and package specifiers", () => {
    const benign =
      "Install @scope/package, compare foo/bar, visit https://example.test/docs/private.ts, and choose yes/no.";
    const prepared = prepareRemoteModelRequest(requestContaining(benign));

    expect(prepared.sensitiveDataDetected).toBe(false);
    expect(prepared.request.goal).toBe(benign);
  });

  it("projects credential-bearing automatic evidence without inspecting raw text", () => {
    const prepared = prepareRemoteModelRequest({
      goal: "Ask about this edit.",
      interactionStyle: "ask-first",
      evidence: {
        id: "dependency:sensitive",
        kind: "new-dependency",
        severity: "warning",
        title: "New dependency introduced",
        detail:
          "Imported https://packages.example/module?api_key=workspace-secret.",
        source: "typescript-semantic-analyzer",
        confidence: 0.94,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
        references: [
          "https://packages.example/module?api_key=workspace-secret",
        ],
      },
    });

    expect(prepared.sensitiveDataDetected).toBe(false);
    expect(prepared.request.evidence).toMatchObject({
      title: "Dependency change detected",
      detail: "A new module dependency was detected at the evidence range.",
      source: "adaptive-pair-semantic-analysis",
      references: [],
    });
    expect(JSON.stringify(prepared.request)).not.toContain("workspace-secret");
  });

  it("redacts quoted credential assignments that contain spaces", () => {
    const credential = "correct horse";
    const prepared = prepareRemoteModelRequest({
      goal: `Investigate password='${credential}'`,
      interactionStyle: "ask-first",
      evidence: {
        id: "dependency:quoted-credential",
        kind: "new-dependency",
        severity: "warning",
        title: "Credential-like assignment introduced",
        detail: `The configuration contains password='${credential}'.`,
        source: "typescript-semantic-analyzer",
        confidence: 0.94,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
        references: [],
      },
    });
    const serialized = JSON.stringify(prepared.request);

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(serialized).not.toContain(credential);
    expect(serialized).toContain("[REDACTED]");
  });

  it("redacts JSON quoted sensitive keys with spaced quoted values", () => {
    const credential = "correct horse battery staple";
    const prepared = prepareRemoteModelRequest(
      requestContaining(`{"password": "${credential}"}`),
    );
    const serialized = JSON.stringify(prepared.request);

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(serialized).not.toContain(credential);
    expect(serialized).toContain("[REDACTED]");
  });

  it.each(sensitiveKeyVariants)(
    "redacts quoted JSON values for the normalized %s key",
    (key) => {
      const credential = `json credential value for ${key}`;
      const prepared = prepareRemoteModelRequest(
        requestContaining(`{"${key}": "${credential}"}`),
      );
      const serialized = JSON.stringify(prepared.request);

      expect(prepared.sensitiveDataDetected).toBe(true);
      expect(serialized).not.toContain(credential);
      expect(serialized).toContain("[REDACTED]");
    },
  );

  it.each(sensitiveKeyVariants)(
    "redacts quoted assignments for the normalized %s key",
    (key) => {
      const credential = `assignment credential value for ${key}`;
      const prepared = prepareRemoteModelRequest(
        requestContaining(`${key} = '${credential}'`),
      );
      const serialized = JSON.stringify(prepared.request);

      expect(prepared.sensitiveDataDetected).toBe(true);
      expect(serialized).not.toContain(credential);
      expect(serialized).toContain("[REDACTED]");
    },
  );

  it("redacts a single-quoted dotted sensitive key", () => {
    const credential = "single quoted credential";
    const prepared = prepareRemoteModelRequest(
      requestContaining(`'api.key': '${credential}'`),
    );
    const serialized = JSON.stringify(prepared.request);

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(serialized).not.toContain(credential);
    expect(serialized).toContain("[REDACTED]");
  });

  it.each([
    ["matching quotes", `"api.key": "matching quoted value"`],
    ["opposite quotes", `"api.key": 'mixed quoted value'`],
    ["opposite single-key quotes", `'api.key': "other mixed quoted value"`],
    ["no value quotes", `"api.key": unquoted-sensitive-value`],
  ])(
    "replaces the field containing a quoted sensitive key with a local-only notice for %s",
    (_label, input) => {
      const prepared = prepareRemoteModelRequest(requestContaining(input));

      expect(prepared.sensitiveDataDetected).toBe(true);
      expect(prepared.request.goal).toBe(localOnlyNotice);
    },
  );

  it("redacts a complete sensitive header value through end-of-line", () => {
    const prepared = prepareRemoteModelRequest(
      requestContaining(
        "Authorization: custom credential value with spaces\nX-Request-Id: benign-id",
      ),
    );

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(prepared.request.goal).toBe(localOnlyNotice);
  });

  it.each([
    ["Cookie", "Cookie: session=exact-cookie-value"],
    ["Set-Cookie", "Set-Cookie: session=exact-set-cookie-value; HttpOnly"],
  ])(
    "keeps an explicit %s header local and out of every remote payload",
    (_label, header) => {
      const prepared = prepareRemoteModelRequest(requestContaining(header));
      const openAiPayload = JSON.stringify(
        buildOpenAICompatiblePromptPayload(requestContaining(header)),
      );
      const copilotPrompt = buildCopilotPrompt(requestContaining(header));

      expect(prepared.sensitiveDataDetected).toBe(true);
      expect(prepared.request.goal).toBe(localOnlyNotice);
      expect(JSON.stringify(prepared.request)).not.toContain(header);
      expect(openAiPayload).not.toContain(header);
      expect(copilotPrompt).not.toContain(header);
    },
  );

  it("finds a sensitive header after a benign colon before redacting to end-of-line", () => {
    const prepared = prepareRemoteModelRequest(
      requestContaining(
        "Changed header: Authorization: custom credential value with spaces",
      ),
    );

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(prepared.request.goal).toBe(localOnlyNotice);
  });

  it.each([
    "accessKeyId",
    "awsAccessKeyId",
    "secretAccessKey",
    "aws_secret_access_key",
    "dbCredential",
    "requestSignature",
    "client-secret",
  ])("redacts a lowercase hexadecimal value keyed by %s", (key) => {
    const credential = "0123456789abcdef".repeat(4);
    const prepared = prepareRemoteModelRequest(
      requestContaining(`${key}=${credential}`),
    );
    const serialized = JSON.stringify(prepared.request);

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(serialized).not.toContain(credential);
    expect(serialized).toContain("[REDACTED]");
  });

  it("redacts a lowercase hexadecimal presigned signature by its sensitive key", () => {
    const signature = "0123456789abcdef".repeat(4);
    const prepared = prepareRemoteModelRequest(
      requestContaining(`X-Amz-Signature=${signature}`),
    );
    const serialized = JSON.stringify(prepared.request);

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(serialized).not.toContain(signature);
    expect(serialized).toContain("[REDACTED]");
  });

  it("preserves an unrelated lowercase hexadecimal commit hash", () => {
    const commitHash = "0123456789abcdef0123456789abcdef01234567";
    const prepared = prepareRemoteModelRequest(
      requestContaining(`commit=${commitHash}`),
    );

    expect(prepared.sensitiveDataDetected).toBe(false);
    expect(JSON.stringify(prepared.request)).toContain(commitHash);
  });

  it("redacts userinfo credentials from non-HTTP DSNs", () => {
    const dsn =
      "amqps://queue-user:queue-password@broker.example.test/private-vhost";
    const prepared = prepareRemoteModelRequest(requestContaining(dsn));
    const serialized = JSON.stringify(prepared.request);

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(serialized).not.toContain("queue-user");
    expect(serialized).not.toContain("queue-password");
    expect(prepared.request.goal).toBe(localOnlyNotice);
  });

  it.each([
    [
      "base64",
      "QWxhZGRpbjpvcGVuIHNlc2FtZSB3aXRoIGFkZGl0aW9uYWwgYnl0ZXM=",
    ],
    [
      "base64url",
      "-yBFao-02f4jSG2St9wBJktwlbrfBClOc5i94gcsUXabwOUKL1R5nsPoDTJXfKE=",
    ],
    [
      "40-character base64",
      "MDEyMzQ1Njc4OWFiY2RlZmdoaWprbG1ub3Bxcg==",
    ],
  ])("redacts long padded %s credential-like values", (_kind, credential) => {
    const prepared = prepareRemoteModelRequest(
      requestContaining(`opaque=${credential}`),
    );
    const serialized = JSON.stringify(prepared.request);

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(serialized).not.toContain(credential);
    expect(serialized).toContain("[REDACTED]");
    expect(prepared.request.goal).toBe(localOnlyNotice);
  });

  it("preserves obvious short benign base64 values", () => {
    const benign = "YWJjZGVmZ2hpamtsbW5vcA==";
    const prepared = prepareRemoteModelRequest(
      requestContaining(`sample=${benign}`),
    );

    expect(prepared.sensitiveDataDetected).toBe(false);
    expect(JSON.stringify(prepared.request)).toContain(benign);
  });

  it.each([
    "@microsoft/applicationinsights-web-snippet",
    "@aws-sdk/credential-provider-node",
    "@company/client-secret-helper",
    "packages/applicationinsights-web-snippet/dist/browser",
    "packages/request-signature-tools/dist/index.js",
    "company/platform-observability-instrumentation",
    "Aa0_".repeat(12),
  ])("preserves the benign package, path, or low-entropy value %s", (benign) => {
    const prepared = prepareRemoteModelRequest(requestContaining(benign));

    expect(prepared.sensitiveDataDetected).toBe(false);
    expect(JSON.stringify(prepared.request)).toContain(benign);
  });

  it("redacts credible mixed-character unpadded token values", () => {
    const credential =
      "A9bC2dE5fG8hJ1kL4mN7pQ0rS3tU6vW9xY2z_AbCdEfGhJk";
    const prepared = prepareRemoteModelRequest(
      requestContaining(`opaque=${credential}`),
    );
    const serialized = JSON.stringify(prepared.request);

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(serialized).not.toContain(credential);
    expect(serialized).toContain("[REDACTED]");
  });

  it("drops a Basic authorization payload supplied only by automatic evidence", () => {
    const basicPayload = Buffer.from(
      "example-user:example-password",
      "utf8",
    ).toString("base64");
    const prepared = prepareRemoteModelRequest({
      goal: "Inspect the authorization change.",
      interactionStyle: "ask-first",
      evidence: {
        id: "dependency:basic-authorization",
        kind: "new-dependency",
        severity: "warning",
        title: `Authorization: Basic ${basicPayload}`,
        detail: "A request header changed.",
        source: "typescript-semantic-analyzer",
        confidence: 0.94,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
        references: [],
      },
    });
    const serialized = JSON.stringify(prepared.request);

    expect(prepared.sensitiveDataDetected).toBe(false);
    expect(serialized).not.toContain(basicPayload);
    expect(serialized).not.toContain(`Basic ${basicPayload}`);
    expect(prepared.request.evidence.title).toBe(
      "Dependency change detected",
    );
  });
});
