# v1 Realtime Pair Implementation Plan (Historical)

> Historical reference from September 12, 2026, associated with the
> [v1 design](v1-design.md). This is not an execution plan for the
> [current v2 design](../design.md). Tool-specific paths and requirements in
> examples below describe the earlier version, not the current repository layout.

**Goal:** Build an installable VS Code extension that turns stable TypeScript and JavaScript edits into local semantic evidence, applies a personalized intervention policy, and renders an inline pair comment without allowing stale writes or uncontrolled model usage.

**Architecture:** A pure TypeScript core owns edit aggregation, semantic evidence, intervention policy, model routing, token budgets, memory, and coexistence state. A thin VS Code adapter subscribes to editor events, reuses diagnostics, renders Comment Threads and a status item, and stores approved settings. The first slice is navigator-only: it never edits project files or runs commands, so coexistence with other coding harnesses is safe by construction.

**Tech Stack:** TypeScript 5.x, VS Code Extension API, TypeScript Compiler API, Vitest, ESLint flat config, npm, `@vscode/vsce`.

## Global Constraints

- Require Node.js 20 or newer and VS Code 1.95 or newer.
- Compile with TypeScript `strict: true`; do not use `any` or unchecked casts.
- Namespace commands, settings, storage, and output as `adaptivePair` or `adaptive-pair`.
- Treat all edits not applied by this extension as `user-supplied`; this slice applies no edits.
- Do not send raw keystrokes, complete files, terminal output, or repository indexes to a model.
- Run local analysis only after a configurable 300-800 ms semantic debounce.
- Default to a zero-token local template provider; remote providers are explicit opt-in.
- Enforce per-window call and token limits before invoking a provider.
- Reuse existing VS Code diagnostics and never start lint, test, or build commands in this slice.
- Detect external harness artifacts without reading or modifying their private configuration.
- Use Apache-2.0-compatible dependencies.

## Scope Boundaries

This plan delivers the first executable pair loop. Separate plans are required
for GitHub-hosted personal memory, the web companion, writable AI-driver
operations, terminal execution, remote Pack distribution, and languages beyond
TypeScript and JavaScript.

## File Map

```text
package.json                                  VS Code manifest and scripts
tsconfig.json                                 strict compiler configuration
eslint.config.mjs                             TypeScript lint rules
.vscodeignore                                 extension package exclusions
src/extension.ts                              extension activation and disposal
src/config/pairConfig.ts                      validated workspace configuration
src/core/types.ts                             shared domain types
src/core/editEpisodeAggregator.ts             debounced edit episodes
src/core/tokenBudget.ts                       rolling call/token limits
src/core/semanticAnalyzer.ts                  incremental TypeScript evidence
src/core/interventionPolicy.ts                cooldown and intervention choice
src/core/modelRouter.ts                       swappable provider interface
src/core/coexistence.ts                       external harness discovery
src/core/memoryStore.ts                       approved local pair preferences
src/vscode/inlinePairController.ts            Comment Thread rendering
src/vscode/pairRuntime.ts                     VS Code event orchestration
test/editEpisodeAggregator.test.ts            aggregation behavior
test/tokenBudget.test.ts                      budget boundaries
test/semanticAnalyzer.test.ts                 semantic evidence scenarios
test/interventionPolicy.test.ts               dedupe and cooldown behavior
test/modelRouter.test.ts                      provider routing and fallback
test/coexistence.test.ts                      harness artifact detection
test/memoryStore.test.ts                      persisted preference behavior
```

---

### Task 1: Extension Toolchain and Manifest

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `.vscodeignore`
- Create: `src/extension.ts`

**Interfaces:**
- Produces: npm scripts `compile`, `lint`, `test`, `check`, and `package`.
- Produces: commands `adaptivePair.toggle`, `adaptivePair.reviewCurrentBlock`, and `adaptivePair.setApiKey`.
- Produces: configuration namespace `adaptivePair`.

- [ ] **Step 1: Create the VS Code manifest**

Create `package.json` with:

```json
{
  "name": "adaptive-pair-harness",
  "displayName": "Adaptive Pair Harness",
  "description": "A realtime, evidence-backed AI pair for VS Code.",
  "version": "0.1.0",
  "publisher": "adaptive-pair",
  "license": "Apache-2.0",
  "engines": {
    "vscode": "^1.95.0",
    "node": ">=20"
  },
  "categories": ["AI", "Programming Languages", "Other"],
  "activationEvents": [
    "onLanguage:typescript",
    "onLanguage:typescriptreact",
    "onLanguage:javascript",
    "onLanguage:javascriptreact",
    "onCommand:adaptivePair.toggle",
    "onCommand:adaptivePair.reviewCurrentBlock"
  ],
  "main": "./dist/src/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "adaptivePair.toggle",
        "title": "Adaptive Pair: Toggle Navigator"
      },
      {
        "command": "adaptivePair.reviewCurrentBlock",
        "title": "Adaptive Pair: Review Current Block"
      },
      {
        "command": "adaptivePair.setApiKey",
        "title": "Adaptive Pair: Set OpenAI-Compatible API Key"
      }
    ],
    "configuration": {
      "title": "Adaptive Pair",
      "properties": {
        "adaptivePair.enabled": {
          "type": "boolean",
          "default": true
        },
        "adaptivePair.debounceMs": {
          "type": "number",
          "default": 500,
          "minimum": 300,
          "maximum": 800
        },
        "adaptivePair.interventionStyle": {
          "type": "string",
          "enum": ["eco", "balanced", "active"],
          "default": "balanced"
        },
        "adaptivePair.model.provider": {
          "type": "string",
          "enum": ["local-template", "openai-compatible"],
          "default": "local-template"
        },
        "adaptivePair.model.baseUrl": {
          "type": "string",
          "default": "http://localhost:11434/v1"
        },
        "adaptivePair.model.name": {
          "type": "string",
          "default": "qwen2.5-coder:7b"
        }
      }
    }
  },
  "scripts": {
    "clean": "rm -rf dist coverage *.vsix",
    "compile": "tsc -p tsconfig.json",
    "lint": "eslint src test",
    "test": "vitest run --coverage",
    "check": "npm run compile && npm run lint && npm run test",
    "package": "vsce package"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

- [ ] **Step 2: Install the existing toolchain dependencies**

Run:

```bash
npm install typescript
npm install --save-dev @types/node @types/vscode vitest @vitest/coverage-v8 eslint @eslint/js typescript-eslint @vscode/vsce
```

Expected: `package-lock.json` is created and `npm audit` completes without an
install failure.

- [ ] **Step 3: Add strict compiler and lint configuration**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022", "DOM"],
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Create `eslint.config.mjs`:

```javascript
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error"
    }
  }
);
```

Create `.vscodeignore`:

```text
.github/**
.superpowers/**
coverage/**
docs/**
src/**
test/**
dist/test/**
*.map
eslint.config.mjs
tsconfig.json
```

- [ ] **Step 4: Add a compilable extension entry point**

Create `src/extension.ts`:

```typescript
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  status.name = "Adaptive Pair";
  status.text = "$(hubot) Pair: starting";
  status.show();
  context.subscriptions.push(status);
}

export function deactivate(): void {}
```

- [ ] **Step 5: Verify compilation and lint**

Run:

```bash
npm run compile
npm run lint
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json eslint.config.mjs .vscodeignore src/extension.ts
git commit -m "chore: scaffold VS Code extension"
```

---

### Task 2: Core Types, Edit Aggregation, and Token Budget

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/editEpisodeAggregator.ts`
- Create: `src/core/tokenBudget.ts`
- Test: `test/editEpisodeAggregator.test.ts`
- Test: `test/tokenBudget.test.ts`

**Interfaces:**
- Produces: `EditEpisode`, `Evidence`, `Intervention`, `PairRange`, and `PairPosition`.
- Produces: `EditEpisodeAggregator.record(snapshot: EditSnapshot): void`.
- Produces: `TokenBudget.tryReserve(inputTokens: number, now: number): BudgetDecision`.

- [ ] **Step 1: Write failing aggregation tests**

Create `test/editEpisodeAggregator.test.ts` with fake scheduler coverage for:

```typescript
it("coalesces rapid edits into one episode with the first before-text", () => {
  const scheduler = new FakeScheduler();
  const episodes: EditEpisode[] = [];
  const aggregator = new EditEpisodeAggregator(500, scheduler, episode => {
    episodes.push(episode);
  });

  aggregator.record(snapshot("before", "first", 2));
  aggregator.record(snapshot("first", "final", 3));
  scheduler.advanceBy(499);
  expect(episodes).toEqual([]);
  scheduler.advanceBy(1);
  expect(episodes[0]).toMatchObject({
    previousText: "before",
    currentText: "final",
    version: 3
  });
});
```

Also test independent document timers and disposal.

- [ ] **Step 2: Run the aggregation tests and verify failure**

Run:

```bash
npx vitest run test/editEpisodeAggregator.test.ts
```

Expected: FAIL because the core types and aggregator do not exist.

- [ ] **Step 3: Implement domain types and edit aggregation**

Define in `src/core/types.ts`:

```typescript
export interface PairPosition {
  readonly line: number;
  readonly character: number;
}

export interface PairRange {
  readonly start: PairPosition;
  readonly end: PairPosition;
}

export interface EditEpisode {
  readonly uri: string;
  readonly languageId: string;
  readonly previousText: string;
  readonly currentText: string;
  readonly version: number;
  readonly observedAt: number;
}

export type EditSnapshot = EditEpisode;

export interface Evidence {
  readonly id: string;
  readonly kind:
    | "new-dependency"
    | "public-api-change"
    | "complexity-growth"
    | "diagnostic"
    | "external-harness";
  readonly severity: "info" | "warning" | "error";
  readonly title: string;
  readonly detail: string;
  readonly source: string;
  readonly confidence: number;
  readonly range: PairRange;
  readonly references: readonly string[];
}

export interface Scheduler {
  schedule(delayMs: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}
```

Implement `EditEpisodeAggregator` with an injected scheduler, one pending
episode per URI, latest version wins, and `dispose()` clearing every timer.

- [ ] **Step 4: Write failing rolling-budget tests**

Create `test/tokenBudget.test.ts` covering:

```typescript
it("rejects calls after either call or token capacity is exhausted", () => {
  const budget = new TokenBudget({
    windowMs: 60_000,
    maxCalls: 2,
    maxInputTokens: 100
  });

  expect(budget.tryReserve(40, 0).allowed).toBe(true);
  expect(budget.tryReserve(40, 1).allowed).toBe(true);
  expect(budget.tryReserve(1, 2)).toMatchObject({
    allowed: false,
    reason: "call-limit"
  });
  expect(budget.tryReserve(90, 60_001).allowed).toBe(true);
});
```

Also test token-limit rejection and exact window expiry.

- [ ] **Step 5: Implement the token budget**

Create `TokenBudget` using timestamped reservations and return:

```typescript
export interface TokenBudgetConfig {
  readonly windowMs: number;
  readonly maxCalls: number;
  readonly maxInputTokens: number;
}

export type BudgetDecision =
  | { readonly allowed: true; readonly remainingCalls: number; readonly remainingInputTokens: number }
  | { readonly allowed: false; readonly reason: "call-limit" | "token-limit"; readonly retryAfterMs: number };
```

- [ ] **Step 6: Run targeted and full tests**

Run:

```bash
npx vitest run test/editEpisodeAggregator.test.ts test/tokenBudget.test.ts
npm run compile
```

Expected: all tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/core test/editEpisodeAggregator.test.ts test/tokenBudget.test.ts
git commit -m "feat: add edit episodes and token budgets"
```

---

### Task 3: Incremental TypeScript Semantic Evidence

**Files:**
- Create: `src/core/semanticAnalyzer.ts`
- Test: `test/semanticAnalyzer.test.ts`

**Interfaces:**
- Consumes: `EditEpisode`, `Evidence`, and `PairRange`.
- Produces: `TypeScriptSemanticAnalyzer.analyze(episode: EditEpisode): readonly Evidence[]`.

- [ ] **Step 1: Write failing analyzer tests**

Create fixtures in `test/semanticAnalyzer.test.ts` and assert:

```typescript
it("reports a newly introduced import", () => {
  const evidence = analyzer.analyze(episode(
    "export const value = 1;",
    'import { save } from "./repository";\nexport const value = 1;'
  ));

  expect(evidence).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: "new-dependency",
      title: "New dependency introduced",
      references: ["./repository"]
    })
  ]));
});

it("reports a changed exported function signature", () => {
  const evidence = analyzer.analyze(episode(
    "export function load(id: string): string { return id; }",
    "export function load(id: number): string { return String(id); }"
  ));

  expect(evidence.some(item => item.kind === "public-api-change")).toBe(true);
});

it("does not intervene while the current source has parse errors", () => {
  const evidence = analyzer.analyze(episode(
    "export function load() {}",
    "export function load("
  ));
  expect(evidence).toEqual([]);
});
```

Add a complexity test where branch count crosses six and grows by at least
three.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run test/semanticAnalyzer.test.ts
```

Expected: FAIL because `TypeScriptSemanticAnalyzer` does not exist.

- [ ] **Step 3: Implement syntax stability and import evidence**

Use `typescript.createSourceFile` for previous and current text. Return no
evidence when current parse diagnostics are non-empty. Collect import module
specifiers and emit one stable-ID evidence item for each newly introduced
specifier.

- [ ] **Step 4: Implement public signature and complexity evidence**

Collect exported function and class method signatures by name. Emit
`public-api-change` when an existing exported signature changes. Count `if`,
`switch` cases, loops, catches, conditional expressions, and logical
short-circuit branches per function; emit `complexity-growth` only when the
current count is at least six and increased by at least three.

- [ ] **Step 5: Run analyzer and full core tests**

Run:

```bash
npx vitest run test/semanticAnalyzer.test.ts
npm run test
npm run compile
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/semanticAnalyzer.ts test/semanticAnalyzer.test.ts
git commit -m "feat: derive semantic evidence from edits"
```

---

### Task 4: Intervention Policy and Swappable Model Router

**Files:**
- Create: `src/core/interventionPolicy.ts`
- Create: `src/core/modelRouter.ts`
- Test: `test/interventionPolicy.test.ts`
- Test: `test/modelRouter.test.ts`

**Interfaces:**
- Consumes: semantic `Evidence` and `TokenBudget`.
- Produces: `InterventionPolicy.decide(input: PolicyInput): PolicyDecision`.
- Produces: `ModelProvider.generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>`.
- Produces: providers `LocalTemplateProvider` and `OpenAICompatibleProvider`.

- [ ] **Step 1: Write failing policy tests**

Cover:

```typescript
it("asks about the highest-confidence new evidence", () => {
  const decision = policy.decide({
    evidence: [lowEvidence, highEvidence],
    style: "balanced",
    now: 1_000
  });
  expect(decision).toMatchObject({
    kind: "intervene",
    evidenceId: highEvidence.id,
    useModel: true
  });
});

it("suppresses duplicate evidence during cooldown", () => {
  policy.decide({ evidence: [highEvidence], style: "balanced", now: 1_000 });
  expect(policy.decide({
    evidence: [highEvidence],
    style: "balanced",
    now: 1_500
  }).kind).toBe("quiet");
});
```

Also test `eco`, `balanced`, and `active` confidence thresholds and local
fallback when the budget rejects a call.

- [ ] **Step 2: Implement the policy**

Use thresholds `0.90`, `0.72`, and `0.55` for eco, balanced, and active.
Maintain last-intervention timestamps by evidence ID. Return:

```typescript
export type PolicyDecision =
  | { readonly kind: "quiet"; readonly reason: string }
  | {
      readonly kind: "intervene";
      readonly evidenceId: string;
      readonly useModel: boolean;
      readonly localMessage: string;
    };
```

- [ ] **Step 3: Write failing provider and router tests**

Test that the local provider produces a question containing the evidence title,
that the router invokes the selected provider, that abort signals propagate,
and that an OpenAI-compatible response is parsed from:

```json
{
  "choices": [
    {
      "message": {
        "content": "Did you intend to introduce this dependency?"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 42,
    "completion_tokens": 11
  }
}
```

- [ ] **Step 4: Implement the provider contract and router**

Define:

```typescript
export interface ModelRequest {
  readonly goal: string;
  readonly evidence: Evidence;
  readonly interactionStyle: "ask-first";
}

export interface ModelResponse {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ModelProvider {
  readonly id: string;
  generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}
```

`LocalTemplateProvider` returns an evidence-specific question with zero tokens.
`OpenAICompatibleProvider` posts a minimal JSON request using injected `fetch`,
checks non-2xx status, validates response shape, and never includes complete
document text.

- [ ] **Step 5: Run policy and router tests**

Run:

```bash
npx vitest run test/interventionPolicy.test.ts test/modelRouter.test.ts
npm run compile
```

Expected: all tests and compilation pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/interventionPolicy.ts src/core/modelRouter.ts test/interventionPolicy.test.ts test/modelRouter.test.ts
git commit -m "feat: add pair policy and model routing"
```

---

### Task 5: Coexistence Discovery and Local Memory

**Files:**
- Create: `src/core/coexistence.ts`
- Create: `src/core/memoryStore.ts`
- Test: `test/coexistence.test.ts`
- Test: `test/memoryStore.test.ts`

**Interfaces:**
- Produces: `discoverHarnessSignals(input: DiscoveryInput): readonly HarnessSignal[]`.
- Produces: `PairMemoryStore.load()`, `approveEvidence()`, `dismissEvidence()`, and `updatePreferences()`.

- [ ] **Step 1: Write failing coexistence tests**

Verify detection of:

```typescript
const signals = discoverHarnessSignals({
  extensionIds: ["github.copilot", "saoudrizwan.claude-dev"],
  workspacePaths: [
    "AGENTS.md",
    "docs/superpowers/plans/2026-09-12-plan.md"
  ]
});

expect(signals.map(signal => signal.kind)).toEqual(
  expect.arrayContaining(["copilot", "cline", "superpowers-plan", "agents-instructions"])
);
```

Also assert deduplication and that discovery never marks a detected tool as the
active driver.

- [ ] **Step 2: Implement read-only discovery**

Return immutable signals with `kind`, `label`, and `source`. Use lower-cased
matching for known extension IDs and normalized POSIX workspace paths. Do not
read file contents.

- [ ] **Step 3: Write failing memory tests**

Use an in-memory key-value adapter and verify:

- defaults load when storage is empty;
- intervention style and pause threshold persist;
- dismissed evidence IDs remain scoped to the current repository;
- approved evidence stores only IDs, kinds, titles, and timestamps, not source
  text or complete code.

- [ ] **Step 4: Implement local approved memory**

Define:

```typescript
export interface PairPreferences {
  readonly interventionStyle: "eco" | "balanced" | "active";
  readonly pauseThresholdMs: number;
}

export interface PairMemory {
  readonly version: 1;
  readonly preferences: PairPreferences;
  readonly dismissedEvidenceByRepository: Readonly<Record<string, readonly string[]>>;
  readonly approvedEvidence: readonly ApprovedEvidence[];
}

export interface ApprovedEvidence {
  readonly id: string;
  readonly kind: Evidence["kind"];
  readonly title: string;
  readonly approvedAt: number;
}

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  update<T>(key: string, value: T): Promise<void>;
}
```

Persist through an injected `KeyValueStore` so the VS Code adapter can use
`globalState` without importing VS Code in the core.

- [ ] **Step 5: Run targeted and full tests**

Run:

```bash
npx vitest run test/coexistence.test.ts test/memoryStore.test.ts
npm run test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/coexistence.ts src/core/memoryStore.ts test/coexistence.test.ts test/memoryStore.test.ts
git commit -m "feat: add coexistence discovery and local memory"
```

---

### Task 6: VS Code Inline Pair Runtime

**Files:**
- Create: `src/config/pairConfig.ts`
- Create: `src/vscode/inlinePairController.ts`
- Create: `src/vscode/pairRuntime.ts`
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes: all core interfaces from Tasks 2-5.
- Produces: `PairRuntime.start()` and `PairRuntime.dispose()`.
- Produces: one active Comment Thread per document and status text describing the control state.

- [ ] **Step 1: Implement validated configuration**

Create `readPairConfig(workspace: vscode.WorkspaceConfiguration): PairConfig`.
Clamp debounce to 300-800 ms and map styles to exact token budgets:

```typescript
export interface PairConfig {
  readonly enabled: boolean;
  readonly debounceMs: number;
  readonly interventionStyle: "eco" | "balanced" | "active";
  readonly provider: "local-template" | "openai-compatible";
  readonly baseUrl: URL | undefined;
  readonly modelName: string;
  readonly budget: TokenBudgetConfig;
}

const STYLE_BUDGETS = {
  eco: { maxCalls: 2, maxInputTokens: 2_000, windowMs: 600_000 },
  balanced: { maxCalls: 4, maxInputTokens: 6_000, windowMs: 600_000 },
  active: { maxCalls: 8, maxInputTokens: 12_000, windowMs: 600_000 }
} as const;
```

Invalid strings fall back to `balanced` or `local-template`; invalid URLs
disable the remote provider and display a status warning.

- [ ] **Step 2: Implement inline Comment Thread rendering**

Create one `vscode.CommentController` named `adaptivePair`. Render:

- the evidence-backed question;
- evidence source and confidence;
- references as Markdown;
- a statement that the pair has not changed code.

Dispose the previous active thread for the same URI before replacing it. Mark
the thread `canReply = false` in this slice and expose deeper interaction through
the `Adaptive Pair: Review Current Block` command.

- [ ] **Step 3: Implement runtime orchestration**

`PairRuntime` must:

1. seed previous text for open documents;
2. listen to TypeScript and JavaScript document changes;
3. aggregate stable edits;
4. cancel stale model requests per URI;
5. analyze the latest episode;
6. apply memory dismissal and intervention policy;
7. use local or configured remote provider;
8. verify the document version still matches before rendering;
9. update the status item with `You drive - Pair navigates`;
10. discover external harness signals and append an observe-only notice without
    changing driver state.

- [ ] **Step 4: Wire commands and secret storage**

Update `src/extension.ts` to:

- construct and start `PairRuntime`;
- register `adaptivePair.toggle`;
- register `adaptivePair.reviewCurrentBlock`;
- register `adaptivePair.setApiKey`;
- store the API key under `adaptivePair.openaiCompatibleApiKey`;
- rebuild runtime configuration after relevant setting changes;
- dispose every listener, thread, status item, and pending timer.

- [ ] **Step 5: Compile and lint the extension**

Run:

```bash
npm run compile
npm run lint
```

Expected: both commands exit 0.

- [ ] **Step 6: Manually exercise the development host**

Run the VS Code extension-development host from the repository:

```bash
code --extensionDevelopmentPath="$PWD"
```

In a TypeScript file, add a new import and pause for the configured debounce.
Expected: an inline Comment Thread appears at the import and the status bar
shows `Pair: You drive`.

- [ ] **Step 7: Commit**

```bash
git add src/config src/vscode src/extension.ts
git commit -m "feat: render realtime inline pair guidance"
```

---

### Task 7: Packaging, Documentation, and Release Verification

**Files:**
- Modify: `README.md`
- Create: `docs/configuration.md`
- Create: `docs/architecture/vertical-slice.md`

**Interfaces:**
- Documents every setting, privacy boundary, supported evidence type, model adapter, and coexistence limitation.
- Produces an installable `.vsix`.

- [ ] **Step 1: Document installation and first run**

Add exact commands to `README.md`:

```bash
npm install
npm run check
npm run package
code --install-extension adaptive-pair-harness-0.1.0.vsix
```

Document the new-import, exported-signature, and complexity-growth evidence
types and state that the extension performs no project-file writes.

- [ ] **Step 2: Document configuration and privacy**

Create `docs/configuration.md` with:

- every `adaptivePair.*` setting and default;
- secret-storage behavior;
- local-template and OpenAI-compatible provider setup;
- exact data sent for a remote request;
- token budgets by interaction style;
- disabling, cooldown, and local-only behavior.

- [ ] **Step 3: Document the implemented architecture**

Create `docs/architecture/vertical-slice.md` covering:

- edit episode flow;
- semantic analyzer boundaries;
- policy and budget decisions;
- model request shape;
- inline rendering lifecycle;
- coexistence discovery and why detection does not imply driver ownership;
- explicit differences between this slice and the full design.

- [ ] **Step 4: Run all verification**

Run:

```bash
npm run clean
npm run check
npm run package
git diff --check
```

Expected:

- TypeScript compilation exits 0;
- ESLint exits 0 with no warnings;
- all Vitest tests pass with coverage output;
- `adaptive-pair-harness-0.1.0.vsix` is created;
- `git diff --check` prints nothing.

- [ ] **Step 5: Inspect the package**

Run:

```bash
unzip -l adaptive-pair-harness-0.1.0.vsix
```

Expected: package includes `extension/package.json`, `extension/dist/src/**`,
`extension/README.md`, and `extension/LICENSE`, and excludes source, tests,
coverage, and design documents.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/configuration.md docs/architecture/vertical-slice.md
git commit -m "docs: explain realtime pair vertical slice"
```
