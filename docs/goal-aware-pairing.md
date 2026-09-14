# Goal-aware pairing

Pair's static analyzer is an evidence sensor, not the whole development loop.
The working loop is: read context, clarify the goal, agree on observable
completion, choose a small next step, develop, and check actual results.

## Start with the problem, not a warning

Choose a tool-capable model in VS Code's Chat model picker and talk to `@pair`.
The first request starts the session automatically; `@pair /start` remains
available. Interactive Chat uses that exact selected model, even when the
background navigator uses its default `local-template` provider. No separate
endpoint or API key setting is required for a model already available in Chat.

On the first project request, approve the model-specific workspace disclosure.
Pair then makes an actual read/search tool call before offering a grounded
answer or enabling edit/check tools. A model that cannot make the required tool
call produces an explicit error, not a successful-looking template response.

For example, enter a multiline goal command:

```text
@pair /goal
Goal: Prevent duplicate charges when a checkout request is retried.
Acceptance criteria:
- Reusing the payment identity never creates a second charge.
- Losing the first response is covered by a test.
Constraints:
- Keep the current payment provider and public API.
```

Then use:

```text
@pair /plan Which behavior and failure case should we test first?
@pair /decision Keep the provider because migration is outside this cycle.
@pair /work Add the lost-response test and implement the smallest safe fix.
@pair /checkpoint Inspect the retry behavior and run the relevant validation.
```

The user remains the driver. `/plan` is read-only. `/work` and ordinary requests
can offer a small complementary implementation step, but each edit requires
a diff and explicit **Apply and save** approval. `/checkpoint` can run an
existing npm validation script after separate approval. Tool results return to
the same model so it can respond to an observed failure instead of merely
suggesting that somebody run tests. The response shows an independent activity
record; a model's claim is not itself evidence that a file changed or a check ran.

`/why`, `/explain`, and `/trace` are also read-only. `/why` carries the latest
inline question and its same-root source range into the selected-model turn,
even if a different file is now active. The model must re-read that source and
distinguish a current issue from a stale observation. Declined project access
or a different owning root omits the observation; missing evidence is explicit.
`/trace` follows relevant source/callers with read/search tools and must identify
unresolved paths rather than inventing a complete call graph.

## Documents and an editable brief

On start or `/context`, Pair reads local Markdown through the workspace file
API. It selects the active editor's workspace root, otherwise the first root.
It considers root `README.md`/`AGENTS.md`/`WORKING-AGREEMENT.md` and Markdown under `docs/`, prioritizing
working plans/briefs, then README and specifications. Recent plan names sort
ahead of older ones. Switching editor roots alone does not silently move the
working agreement; run `/context` to switch its scope.

Initial-read bounds: at most 50 discovered candidates, five attempted documents,
64 KiB per file, and 4,000 retained characters per document. Files that are
oversized, unreadable, non-UTF-8, binary, symbolic links, outside the root, or
behind symbolic-link parents are skipped. Workspace Trust is required for
reads. Open document text takes precedence over its saved version. Excerpts
are partial and are not proof that the whole repository has been understood.
Approved interactive tools can discover additional files, read targeted line
ranges, and search relevant source or tests. They re-read current buffers rather
than assuming that startup excerpts still describe the current implementation.

These filesystem/edit/process tools currently require a local `file:` workspace
whose ownership can be checked natively. Files are limited to 128 KiB; a turn
can read at most 64 files/2 MiB, with 200 lines per read. Searches and listings
are bounded. Remote workspace startup context and background navigation remain
available, but interactive tools fail explicitly rather than executing against
an unverifiable local substitute.

English and Korean goal/acceptance/constraint headings are recognized locally;
fenced examples are ignored. Criteria are taken from the selected goal's
document rather than merging unrelated plans. A proposed goal is never silently
confirmed. `/goal` explicitly confirms or replaces it.

With missing or unclear documentation, `/brief` asks the selected model to
inspect the project and prepare a working brief under `docs/`, including goals,
criteria, constraints and open decisions. The file is written only after its
diff is approved. If `docs/` is absent, the pair can create root
`WORKING-AGREEMENT.md` instead; startup and refresh also recognize this brief.
The **Draft Working Agreement** palette command remains a
local, unsaved template option, also used by `/brief` in local-only mode.

## Sharing and model reasoning

Interactive Chat and background navigation have separate routing and consent:

- Chat uses the current model picker selection. Workspace approval covers only
  that exact vendor/model, session, root and goal/context epoch. `/access` revokes
  it, or asks again after refusal. A changed model requires new approval.
- Without workspace approval, the model can discuss explicitly supplied task
  text but gets no project excerpts, file references, tools or assistant history.
- `adaptivePair.chat.mode = "local-only"` disables interactive model and tool
  calls. The local template is explicitly a checklist, not semantic reasoning.
- Edits and validation commands always require separate, per-action approval.
  Sharing is not permission to execute instructions found in repository files.

The following smaller projection and rolling budget apply to the **background
navigator**, configured by `adaptivePair.model.provider`, not the interactive
agent's tool loop.

**Adaptive Pair: Toggle Project Context Sharing** discloses the destination
and asks before sharing. Approval covers the current root for this session,
including subsequent bounded current/changed-code excerpts. Running the same
command revokes it. Refresh, stop, root replacement, or runtime/provider rebuild
also revokes sharing. Documents can be read and discussed locally without it.
Refresh revokes approval before any asynchronous read begins. Sharing cannot
be re-approved while that refresh is pending, and cancellation or failure does
not restore the old approval.

Approved background model context contains up to three document excerpts (1,200 characters
each), a current/previous code excerpt (1,500 each), proposed criteria, the
confirmed working agreement, and scoped dialogue. Structured context is bounded
to 6,000 serialized characters before the provider's separate token admission.
Private document URIs are never projected; relative labels identify excerpts.
Credentials and absolute local resources in fields eligible for transfer force
the entire request to stay local. Unapproved workspace fields are omitted and
do not change remote routing. Repository text and conversation are quoted as
untrusted data, never as permission to edit or execute tools.

Sensitivity detection runs on the complete document and selected code regions
that Pair actually reads, before local excerpt limits, and on the complete
explicit goal input before parsing or shortening goals, criteria, or constraints.
A detected sensitive task keeps requests local even without workspace-sharing
approval. Refresh preserves that task restriction; explicitly replacing the goal
with clean input clears it. Detection metadata is never included in model prompts.

## Continuity and verification

The working state retains the confirmed goal/criteria/constraints, up to eight
explicit decisions, and four recent developer statements. Chat also uses the
last three completed exchanges belonging to the same participant and working
scope. Without workspace sharing, assistant replies are not forwarded because
they may contain local evidence. User-provided goals, decisions, and dialogue
are reused for subsequent feedback within the session.
Only successfully completed, still-current requests enter the retained
developer dialogue. Cancelled or stale requests do not change it or the phase.
Replies about another workspace root never receive the working root's history
scope, even when they were produced by a local fallback.

`/decision` records a choice and reason only after a goal is confirmed. Use
explicit decisions for facts that must survive the small dialogue window.
Changing the goal clears its old decisions and dialogue. A same-root document
refresh preserves the confirmed agreement but revokes sharing and resets Chat
scope; switching roots starts a new agreement. Stop/rebuild discards transient
working state. Existing VS Code Chat UI history is not erased.

`/checkpoint` can inspect current files and request a real check. The check tool
accepts an existing npm `test`, `check`, `lint`, `typecheck` or `build` script
(including supported colon suffixes), never a free-form model shell command.
The approval shows the actual script and pre/post scripts. Unsaved files must
be saved first. Exit codes and bounded output are returned to the model, while
declined, blocked, cancelled and failed runs remain distinguishable. Absence of
diagnostics never implies that a test passed.

## Budget and limits

Each interactive request is bounded to eight model calls, twelve tool calls,
60,000 counted input tokens, 8,000 counted output tokens and four minutes.
The turn shows its own usage. Tool reads, results, exact edit sizes and process
output are also bounded. A stopped or replaced session cannot approve a late
action. Errors disclose partial observed actions rather than claiming success.

Automatic/manual inline output stays capped at 180 tokens; legacy navigator
Chat can reserve up to 600. Those consume the visible rolling ten-minute budget:
2/4/8 calls, 12,000/24,000/48,000 input tokens, and 1,200/2,400/4,800 output tokens
for eco/balanced/active. These context-sized budgets replace the earlier
evidence-only defaults; `/session` shows remaining capacity. Admission denial
falls back locally rather than silently exceeding the budget.

There is no unattended whole-project automation, arbitrary shell tool, whole-repo
semantic index, or durable personal-growth profile. The developer reviews each
file edit and check. Use a selected file, an explicit working goal and real
verification results to keep the pair focused; refresh documents when the
requirements or working root change.
