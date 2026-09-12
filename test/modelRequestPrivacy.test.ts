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
] as const;

describe("remote model request privacy", () => {
  it("removes unbounded third-party diagnostic text and preserves safe metadata", () => {
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
      expect(payload).toContain("typescript");
      expect(payload).toContain("Diagnostic code: TS2322");
      expect(payload).toContain("error");
      expect(payload).toContain("10:2-10:22");
      expect(payload).toContain("Problems");
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
    expect(plan.kind).toBe("generate");
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(sourceCode);
    expect(serialized).toContain(
      "See VS Code Problems for the complete diagnostic message.",
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

  it("marks sensitive automatic evidence for local-only handling", () => {
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

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(prepared.request.evidence.detail).not.toContain("workspace-secret");
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
    [
      "matching quotes",
      `"api.key": "matching quoted value"`,
      `"api.key": "[REDACTED]"`,
    ],
    [
      "opposite quotes",
      `"api.key": 'mixed quoted value'`,
      `"api.key": '[REDACTED]'`,
    ],
    [
      "opposite single-key quotes",
      `'api.key': "other mixed quoted value"`,
      `'api.key': "[REDACTED]"`,
    ],
    [
      "no value quotes",
      `"api.key": unquoted-sensitive-value`,
      `"api.key": [REDACTED]`,
    ],
  ])(
    "redacts a quoted sensitive key independently from %s around its value",
    (_label, input, expected) => {
      const prepared = prepareRemoteModelRequest(requestContaining(input));

      expect(prepared.sensitiveDataDetected).toBe(true);
      expect(prepared.request.goal).toBe(expected);
    },
  );

  it("redacts a complete sensitive header value through end-of-line", () => {
    const prepared = prepareRemoteModelRequest(
      requestContaining(
        "Authorization: custom credential value with spaces\nX-Request-Id: benign-id",
      ),
    );

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(prepared.request.goal).toBe(
      "Authorization: [REDACTED] X-Request-Id: benign-id",
    );
  });

  it("finds a sensitive header after a benign colon before redacting to end-of-line", () => {
    const prepared = prepareRemoteModelRequest(
      requestContaining(
        "Changed header: Authorization: custom credential value with spaces",
      ),
    );

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(prepared.request.goal).toBe(
      "Changed header: Authorization: [REDACTED]",
    );
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
    expect(serialized).toContain("amqps://broker.example.test/private-vhost");
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
    expect(prepared.request.goal).toBe("opaque=[REDACTED]");
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

  it("redacts the complete Basic authorization payload", () => {
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

    expect(prepared.sensitiveDataDetected).toBe(true);
    expect(serialized).not.toContain(basicPayload);
    expect(serialized).not.toContain(`Basic ${basicPayload}`);
  });
});
