import * as vscode from "vscode";
import type { ExtensionContext } from "vscode";
import {
  PresenceController,
  type AdaptivePairExtensionApi,
} from "./presenceController.js";
import { SessionController } from "./sessionController.js";
import { StatusView } from "./statusView.js";
import { PairToolContext } from "./tools/pairToolContext.js";
import { registerPairTools } from "./tools/registerPairTools.js";
import {
  GrowthEvaluationLog,
  GrowthParticipant,
  ModelConsentRegistry,
} from "./growthParticipant.js";
import { createGrowthModel } from "./modelAdapter.js";

const GROWTH_PARTICIPANT_ID = "adaptivePair.chat";

const requestWorkspaceConsent = async (
  model: vscode.LanguageModelChat,
): Promise<boolean> => {
  const choice = await vscode.window.showWarningMessage(
    `Share bounded workspace and conversation context with ${model.name} for this Growth hint? Raw model output is never stored.`,
    { modal: true },
    "Share with this model",
  );
  return choice === "Share with this model";
};

const confirmSolutionReveal = async (
  model: vscode.LanguageModelChat,
): Promise<boolean> => {
  const choice = await vscode.window.showWarningMessage(
    `Reveal the full solution with ${model.name}? This records your explicit authorization before a level-5 response.`,
    { modal: true },
    "Reveal solution",
  );
  return choice === "Reveal solution";
};

export const activate = (
  context: ExtensionContext,
): AdaptivePairExtensionApi => {
  const sessionController = new SessionController();
  const statusView = new StatusView();
  const toolContext = new PairToolContext();
  const presenceController = new PresenceController(
    sessionController,
    statusView,
    toolContext,
  );

  presenceController.register(context);

  const coordinator = sessionController.coordinator();
  registerPairTools(context, coordinator);

  const growthParticipant = new GrowthParticipant({
    coordinator,
    consent: new ModelConsentRegistry(),
    evaluations: new GrowthEvaluationLog(),
    createModel: model => createGrowthModel(model, coordinator),
    requestWorkspaceConsent,
    confirmSolutionReveal,
    stayQuiet: () => sessionController.stayQuiet(),
  });

  context.subscriptions.push(
    vscode.chat.createChatParticipant(
      GROWTH_PARTICIPANT_ID,
      growthParticipant.handler(),
    ),
  );

  return Object.freeze({
    getState: () => presenceController.getState(),
  });
};

export const deactivate = (): void => {};
