import assert from "node:assert/strict";
import { appendFile, lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import { createPairWorkspaceTools } from "../../src/vscode/pairWorkspaceTools";

interface HostFixture {
  runId: string;
  repositoryPath: string;
  workspacePath: string;
  extensionId: string;
}

type Toolbox = ReturnType<typeof createPairWorkspaceTools>;
type ToolOptions = Parameters<typeof createPairWorkspaceTools>[0];
type ToolResult = Awaited<ReturnType<Toolbox["invoke"]>>;

const assertStatus = (result: ToolResult, expected: ToolResult["status"]): void => {
  assert.equal(result.status, expected, JSON.stringify(result));
  assert.equal(typeof result.text, "string");
  assert.equal(typeof result.summary, "string");
};

const replaceBuffer = async (
  document: vscode.TextDocument,
  text: string,
): Promise<void> => {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
    text,
  );
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  assert.equal(document.getText(), text);
};

export async function run(): Promise<void> {
  const requestedRoot = process.env.ADAPTIVE_PAIR_HOST_TEST_ROOT;
  assert.ok(requestedRoot, "Launch this suite with scripts/test-extension-host.mjs.");
  const root = await realpath(requestedRoot);
  assert.equal(root, path.resolve(requestedRoot));
  assert.ok(path.basename(root).startsWith("adaptive-pair-host-"));
  const fixture = JSON.parse(
    await readFile(path.join(root, "fixture.json"), "utf8"),
  ) as HostFixture;
  assert.equal(fixture.runId, process.env.ADAPTIVE_PAIR_HOST_TEST_RUN_ID);
  assert.ok(fixture.runId);
  assert.equal(await realpath(fixture.workspacePath), path.join(root, "workspace"));

  const passed: string[] = [];
  const failures: { name: string; error: unknown }[] = [];
  const log = async (message: string): Promise<void> => {
    const line = `[host-smoke] ${message}`;
    console.log(line);
    await appendFile(path.join(root, "smoke.log"), `${line}\n`);
  };
  const step = async (
    name: string,
    check: () => Promise<void>,
    options: { stopOnFailure?: boolean } = {},
  ): Promise<void> => {
    await log(`RUN ${name}`);
    try {
      await check();
      passed.push(name);
      await log(`PASS ${name}`);
    } catch (error) {
      failures.push({ name, error });
      await log(`FAIL ${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      if (options.stopOnFailure) throw error;
    }
  };
  const report = async (error?: unknown): Promise<void> => {
    await writeFile(path.join(root, "smoke-result.json"), JSON.stringify({
      runId: fixture.runId,
      status: error === undefined ? "passed" : "failed",
      vscodeVersion: vscode.version,
      extensionId: fixture.extensionId,
      passed,
      failed: failures.map((failure) => ({
        name: failure.name,
        error: failure.error instanceof Error ? failure.error.stack ?? failure.error.message : String(failure.error),
      })),
      error: error instanceof Error ? error.stack ?? error.message : error,
      languageModelExercised: false,
      approvalUiExercised: false,
    }, null, 2));
  };
  const rootUri = vscode.Uri.file(fixture.workspacePath);
  const uri = (filePath: string): vscode.Uri => vscode.Uri.joinPath(rootUri, filePath);
  const diskText = async (filePath: string): Promise<string> =>
    Buffer.from(await vscode.workspace.fs.readFile(uri(filePath))).toString("utf8");
  const toolboxes: Toolbox[] = [];
  const makeTools = (
    options: Pick<ToolOptions, "confirmEdit" | "confirmCheck"> = {},
  ): Toolbox => {
    const toolbox = createPairWorkspaceTools({
      rootUri,
      isCurrent: () => true,
      confirmEdit: async () => assert.fail("Unexpected edit confirmation"),
      confirmCheck: async () => assert.fail("Unexpected check confirmation"),
      ...options,
    });
    toolboxes.push(toolbox);
    return toolbox;
  };
  const invoke = (
    toolbox: Toolbox,
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> => toolbox.invoke(name, input, new AbortController().signal);

  try {
    await step("isolated native workspace", async () => {
      assert.equal(vscode.env.uiKind, vscode.UIKind.Desktop);
      assert.equal(vscode.env.remoteName, undefined);
      assert.equal(vscode.workspace.workspaceFolders?.length, 1);
      assert.equal(vscode.workspace.workspaceFolders[0]?.uri.toString(), rootUri.toString());
      assert.equal(vscode.workspace.isTrusted, true);
      assert.equal(process.env.USERPROFILE, path.join(root, "home"));
      assert.equal(process.env.npm_config_userconfig, path.join(root, "empty.npmrc"));
      assert.equal(vscode.workspace.getConfiguration("adaptivePair").get("enabled"), false);
      assert.equal(vscode.workspace.getConfiguration("adaptivePair").get("model.provider"), "local-template");
      assert.equal(await diskText("target.txt"), "disk baseline\nsecond line\n");
    }, { stopOnFailure: true });

    await step("extension activation and contributed commands", async () => {
      const extension = vscode.extensions.getExtension(fixture.extensionId);
      assert.ok(extension, `Development extension ${fixture.extensionId} was not discovered`);
      assert.equal(await realpath(extension.extensionPath), await realpath(fixture.repositoryPath));
      await log(`Activating ${extension.id} in VS Code ${vscode.version}`);
      await extension.activate();
      await log(`Activation resolved: ${extension.id}; active=${extension.isActive}`);
      assert.equal(extension.isActive, true);
      const manifest = extension.packageJSON as {
        contributes?: { commands?: { command: string }[] };
      };
      const contributions = manifest.contributes?.commands;
      assert.ok(contributions && contributions.length > 0, "No contributed commands found");
      await log(`Checking ${contributions.length} contributed commands`);
      const commands = new Set(await vscode.commands.getCommands(true));
      for (const contribution of contributions) {
        assert.ok(commands.has(contribution.command), `Missing command: ${contribution.command}`);
      }
      assert.ok(commands.has("adaptivePair.stopSession"));
      await log(`VS Code ${vscode.version}; activated ${extension.id}; ${contributions.length} commands`);
    });

    await step("unopened-file read uses native disk", async () => {
      const toolbox = makeTools();
      const targetUri = uri("unopened.txt");
      const logMetadata = async (phase: "before" | "after"): Promise<void> => {
        const nativeStat = await lstat(targetUri.fsPath);
        const workspaceStat = await vscode.workspace.fs.stat(targetUri);
        await log(`Unopened-file metadata ${phase}: ${JSON.stringify({
          uri: targetUri.toString(),
          uriPath: targetUri.path,
          fsPath: targetUri.fsPath,
          lstat: {
            dev: nativeStat.dev,
            ino: nativeStat.ino,
            size: nativeStat.size,
            mtimeMs: nativeStat.mtimeMs,
            ctimeMs: nativeStat.ctimeMs,
          },
          workspaceStat,
        })}`);
      };
      await logMetadata("before");
      const read = await invoke(toolbox, "read_file", { path: "unopened.txt" });
      await logMetadata("after");
      assertStatus(read, "ok");
      assert.match(read.text, /unopened disk baseline/);
    });

    await step("native unsaved-buffer read and exact target-only saved edit", async () => {
      let approvals = 0;
      const toolbox = makeTools({
        confirmEdit: async (proposal, signal) => {
          signal.throwIfAborted();
          approvals += 1;
          assert.equal(proposal.path, "target.txt");
          assert.equal(proposal.before, "unsaved baseline\nsecond line\n");
          assert.equal(proposal.after, "pair edit saved\nsecond line\n");
          assert.equal(proposal.dirty, true);
          return true;
        },
      });
      const definitions = new Set(toolbox.definitions.map((definition) => definition.name));
      for (const name of ["list_files", "read_file", "search_files", "edit_file", "run_check"]) {
        assert.ok(definitions.has(name), `Missing tool definition: ${name}`);
      }
      const document = await vscode.workspace.openTextDocument(uri("target.txt"));
      await vscode.window.showTextDocument(document, { preview: false });
      const unrelated = await vscode.workspace.openTextDocument(uri("untouched.txt"));
      await replaceBuffer(unrelated, "unrelated unsaved buffer\n");
      await replaceBuffer(document, "unsaved baseline\nsecond line\n");
      assert.equal(document.isDirty, true);
      assert.equal(await diskText("target.txt"), "disk baseline\nsecond line\n");
      const read = await invoke(toolbox, "read_file", { path: "target.txt" });
      assertStatus(read, "ok");
      assert.match(read.text, /unsaved baseline/);
      assert.doesNotMatch(read.text, /disk baseline/);
      const edited = await invoke(toolbox, "edit_file", {
        path: "target.txt", oldText: "unsaved baseline", newText: "pair edit saved",
      });
      assertStatus(edited, "ok");
      assert.equal(approvals, 1);
      assert.equal(document.getText(), "pair edit saved\nsecond line\n");
      assert.equal(document.isDirty, false);
      assert.equal(await diskText("target.txt"), document.getText());
      assert.equal(unrelated.getText(), "unrelated unsaved buffer\n");
      assert.equal(unrelated.isDirty, true);
      assert.equal(await diskText("untouched.txt"), "unrelated disk baseline\n");
    });

    await step("native file listing", async () => {
      const toolbox = makeTools();
      const candidates = await vscode.workspace.findFiles(new vscode.RelativePattern(rootUri, "**/*.txt"));
      await log(`Native discovery: ${JSON.stringify({ root: rootUri.toString(), candidates: candidates.map((candidate) => candidate.toString()) })}`);
      assert.ok(candidates.some((candidate) => path.basename(candidate.fsPath) === "target.txt"));
      const listed = await invoke(toolbox, "list_files", { pattern: "**/*.txt" });
      assertStatus(listed, "ok");
      assert.match(listed.text, /target\.txt/);
    });

    await step("native line-range read", async () => {
      const toolbox = makeTools();
      const read = await invoke(toolbox, "read_file", {
        path: "target.txt", startLine: 2, endLine: 2,
      });
      assertStatus(read, "ok");
      assert.match(read.text, /second line/);
      assert.doesNotMatch(read.text, /pair edit saved/);
    });

    await step("native literal search", async () => {
      const toolbox = makeTools();
      const found = await invoke(toolbox, "search_files", {
        query: "pair edit saved", pattern: "**/*.txt",
      });
      assertStatus(found, "ok");
      assert.match(found.text, /target\.txt/);
      assert.match(found.text, /pair edit saved/);
    });

    await step("existing and absent targets require a prior read", async () => {
      const toolbox = makeTools({
        confirmEdit: async (proposal) => {
          assert.equal(proposal.path, "created.txt");
          assert.equal(proposal.before, "");
          assert.equal(proposal.after, "created by pair\n");
          return true;
        },
      });
      assertStatus(await invoke(toolbox, "edit_file", {
        path: "unread.txt", oldText: "unread disk baseline", newText: "must not write",
      }), "blocked");
      assert.equal(await diskText("unread.txt"), "unread disk baseline\n");
      assertStatus(await invoke(toolbox, "edit_file", {
        path: "created.txt", oldText: "", newText: "must not create\n",
      }), "blocked");
      await assert.rejects(async () => vscode.workspace.fs.stat(uri("created.txt")), { code: "FileNotFound" });
      const absent = await invoke(toolbox, "read_file", { path: "created.txt" });
      assertStatus(absent, "ok");
      assert.match(absent.text, /absent|not found|not exist|no such file|missing|ENOENT/i);
      let createdDocument: vscode.TextDocument | undefined;
      const observer = vscode.workspace.onDidOpenTextDocument((document) => {
        if (document.uri.fsPath.toLowerCase() === uri("created.txt").fsPath.toLowerCase()) {
          createdDocument = document;
        }
      });
      try {
        const created = await invoke(toolbox, "edit_file", {
          path: "created.txt", oldText: "", newText: "created by pair\n",
        });
        await log(`Creation evidence: ${JSON.stringify({
          status: created.status,
          disk: await diskText("created.txt"),
          document: createdDocument === undefined ? undefined : {
            closed: createdDocument.isClosed,
            dirty: createdDocument.isDirty,
            version: createdDocument.version,
          },
        })}`);
        assertStatus(created, "ok");
      } finally {
        observer.dispose();
      }
      assert.equal(await diskText("created.txt"), "created by pair\n");
    });

    await step("denied edit leaves both buffer and disk unchanged", async () => {
      let approvals = 0;
      const toolbox = makeTools({
        confirmEdit: async (proposal) => {
          approvals += 1;
          assert.equal(proposal.path, "denied.txt");
          return false;
        },
      });
      const document = await vscode.workspace.openTextDocument(uri("denied.txt"));
      assertStatus(await invoke(toolbox, "read_file", { path: "denied.txt" }), "ok");
      assertStatus(await invoke(toolbox, "edit_file", {
        path: "denied.txt", oldText: "denied disk baseline", newText: "must not write",
      }), "declined");
      assert.equal(approvals, 1);
      assert.equal(document.getText(), "denied disk baseline\n");
      assert.equal(document.isDirty, false);
      assert.equal(await diskText("denied.txt"), document.getText());
    });

    await step("stale read cannot overwrite a newer unsaved buffer", async () => {
      const toolbox = makeTools();
      const document = await vscode.workspace.openTextDocument(uri("stale.txt"));
      assertStatus(await invoke(toolbox, "read_file", { path: "stale.txt" }), "ok");
      await replaceBuffer(document, "newer unsaved user text\n");
      assertStatus(await invoke(toolbox, "edit_file", {
        path: "stale.txt", oldText: "stale disk baseline", newText: "must not overwrite",
      }), "blocked");
      assert.equal(document.getText(), "newer unsaved user text\n");
      assert.equal(document.isDirty, true);
      assert.equal(await diskText("stale.txt"), "stale disk baseline\n");
    });

    await step("buffer changed during approval is not overwritten", async () => {
      const document = await vscode.workspace.openTextDocument(uri("approval-race.txt"));
      let approvals = 0;
      const toolbox = makeTools({
        confirmEdit: async () => {
          approvals += 1;
          await replaceBuffer(document, "typed while approval was open\n");
          return true;
        },
      });
      assertStatus(await invoke(toolbox, "read_file", { path: "approval-race.txt" }), "ok");
      assertStatus(await invoke(toolbox, "edit_file", {
        path: "approval-race.txt", oldText: "approval race disk baseline", newText: "must not overwrite",
      }), "blocked");
      assert.equal(approvals, 1);
      assert.equal(document.getText(), "typed while approval was open\n");
      assert.equal(document.isDirty, true);
      assert.equal(await diskText("approval-race.txt"), "approval race disk baseline\n");
    });

    await step("root escape and synthetic secret paths are blocked", async () => {
      const toolbox = makeTools();
      const outside = path.join(root, "outside.txt");
      for (const blockedPath of ["../outside.txt", outside, ".env"]) {
        const read = await invoke(toolbox, "read_file", { path: blockedPath });
        if (blockedPath === ".env") assertStatus(read, "blocked");
        else {
          assert.ok(["blocked", "error"].includes(read.status), JSON.stringify(read));
          assert.match(read.text, /relative path|outside.*workspace|protected.*paths/i);
        }
        assert.doesNotMatch(read.text, /outside-root smoke sentinel|synthetic-not-a-real-credential/);
        const edit = await invoke(toolbox, "edit_file", {
          path: blockedPath, oldText: "", newText: "must not write",
        });
        if (blockedPath === ".env") assertStatus(edit, "blocked");
        else {
          assert.ok(["blocked", "error"].includes(edit.status), JSON.stringify(edit));
          assert.match(edit.text, /relative path|outside.*workspace|protected.*paths/i);
        }
      }
      const listed = await invoke(toolbox, "list_files", { pattern: "**/*" });
      assertStatus(listed, "ok");
      assert.doesNotMatch(listed.text, /(?:^|[\s/\\])\.env(?:$|\s)/m);
      const secretSearch = await invoke(toolbox, "search_files", {
        query: "SMOKE_ONLY_SECRET", pattern: "**/*",
      });
      assert.ok(["ok", "blocked"].includes(secretSearch.status), JSON.stringify(secretSearch));
      assert.doesNotMatch(secretSearch.text, /synthetic-not-a-real-credential/);
      assert.equal(await readFile(outside, "utf8"), "outside-root smoke sentinel\n");
      assert.equal(await diskText(".env"), "SMOKE_ONLY_SECRET=synthetic-not-a-real-credential\n");
    });

    await step("denied validation launches no process", async () => {
      for (const filePath of ["untouched.txt", "stale.txt", "approval-race.txt"]) {
        const document = await vscode.workspace.openTextDocument(uri(filePath));
        await replaceBuffer(document, await diskText(filePath));
        assert.equal(await document.save(), true);
        assert.equal(document.isDirty, false);
      }
      let approvals = 0;
      const toolbox = makeTools({
        confirmCheck: async (proposal, signal) => {
          signal.throwIfAborted();
          approvals += 1;
          assert.equal(proposal.script, "lint");
          assert.match(proposal.command, /validate\.cjs denied/);
          return false;
        },
      });
      await vscode.workspace.openTextDocument(uri("package.json"));
      assertStatus(await invoke(toolbox, "read_file", { path: "package.json" }), "ok");
      assertStatus(await invoke(toolbox, "run_check", { script: "lint" }), "declined");
      assert.equal(approvals, 1);
      await assert.rejects(async () => vscode.workspace.fs.stat(uri("check-runs.txt")), { code: "FileNotFound" });
    });

    await step("real fixture validation exits zero and nonzero", async () => {
      const approvals: string[] = [];
      const toolbox = makeTools({
        confirmCheck: async (proposal, signal) => {
          signal.throwIfAborted();
          approvals.push(proposal.script);
          assert.ok(["check", "test"].includes(proposal.script));
          assert.match(proposal.command, /validate\.cjs (?:pass|fail)/);
          return true;
        },
      });
      assertStatus(await invoke(toolbox, "read_file", { path: "package.json" }), "ok");
      const successful = await invoke(toolbox, "run_check", { script: "check" });
      assertStatus(successful, "ok");
      assert.match(successful.text, /\[fixture-check\] pass exit=0/);
      assert.equal(await diskText("check-runs.txt"), "pass\n");
      const failed = await invoke(toolbox, "run_check", { script: "test" });
      assertStatus(failed, "error");
      assert.match(failed.text, /\[fixture-check\] fail exit=7/);
      assert.equal(await diskText("check-runs.txt"), "pass\nfail\n");
      assert.deepEqual(approvals, ["check", "test"]);
      await log(`check: ${successful.status}; ${successful.text.trim()}`);
      await log(`test: ${failed.status}; ${failed.text.trim()}`);
    });

    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.error),
        `${passed.length} checks passed; ${failures.length} failed: ${failures.map((failure) => failure.name).join("; ")}`,
      );
    }
    await log(`PASS ${passed.length} checks; real native APIs; no LLM or approval UI exercised`);
    await report();
  } catch (error) {
    await log(`FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    const buffers = vscode.workspace.textDocuments
      .filter((document) => document.isDirty && vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() === rootUri.toString())
      .map((document) => ({ path: document.uri.fsPath, text: document.getText() }));
    await writeFile(path.join(root, "dirty-buffers.json"), JSON.stringify(buffers, null, 2));
    await report(error);
    throw error;
  } finally {
    for (const toolbox of toolboxes) {
      toolbox.dispose?.();
    }
  }
}
