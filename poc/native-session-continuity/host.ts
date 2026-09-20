import * as vscode from "vscode";
import { writeFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { runScenario } from "./scenarios.js";
import { errorMessage, requiredEnvironment, type ProbeApi, type ProbeEvidence } from "./contracts.js";

export const run = async (): Promise<void> => {
  const evidence: ProbeEvidence = {
    hostVersion: vscode.version, nodeVersion: process.versions.node, phase: requiredEnvironment("AP_NATIVE_PHASE"),
  };
  let api: ProbeApi | undefined;
  try {
    const extension = vscode.extensions.getExtension<ProbeApi>("adaptive-pair.native-session-continuity-probe");
    assert.ok(extension);
    api = await extension.activate();
    const models = await vscode.lm.selectChatModels({ vendor: "adaptive-pair-native-probe" });
    evidence.models = models.map(model => ({ id: model.id, vendor: model.vendor, family: model.family }));
    evidence.chatApiKeys = Object.keys(vscode.chat);
    evidence.commands = (await vscode.commands.getCommands(true)).filter(command =>
      /chat\..*(?:open|newChat|submit|clear|delete|history|fork|session)|agentSession\.|dialog/iu.test(command),
    );
    evidence.copilot = vscode.extensions.all.filter(candidate => /copilot/iu.test(candidate.id))
      .map(candidate => {
        const manifest = candidate.packageJSON as { readonly version?: unknown };
        return { id: candidate.id, version: typeof manifest.version === "string" ? manifest.version : "unknown" };
      });
    assert.equal(models.length, 1);
    await vscode.commands.executeCommand("workbench.action.chat.open", { mode: "ask" });
    if (process.env.AP_NATIVE_RESOURCE) {
      await vscode.commands.executeCommand("workbench.action.chat.openSessionInEditorGroup", {
        resource: vscode.Uri.parse(process.env.AP_NATIVE_RESOURCE),
      });
    }
    await vscode.commands.executeCommand("workbench.action.chat.changeModel", evidence.models[0]);
    await runScenario(api, evidence);
    await new Promise(resolve => setTimeout(resolve, 1000));
    evidence.state = api.getState();
    assert.equal(evidence.state.modelCalls, 0);
    assert.match(evidence.state.disposalApi, /CANNOT use API proposal: chatParticipantPrivate/u);
    evidence.status = "passed";
  } catch (error) {
    evidence.status = "failed";
    evidence.error = errorMessage(error);
    if (api) evidence.state = api.getState();
    throw error;
  } finally {
    await writeFile(requiredEnvironment("AP_NATIVE_RESULT"), `${JSON.stringify(evidence, null, 2)}\n`);
  }
};
