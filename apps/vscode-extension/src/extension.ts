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
import { ActivityLedger } from "./activityLedger.js";
import { StableEffectPort, type VerificationRunner } from "./stableEffectPort.js";
import {
  createVerificationAdapter,
  VscodeConfirmationPort,
  type ConfirmationPort,
  type ConfirmationRequest,
} from "./verificationAdapter.js";
import { createHostTestApi } from "./hostTestApi.js";

const GROWTH_PARTICIPANT_ID = "adaptivePair.chat";

const isHostTest = (): boolean => process.env["ADAPTIVE_PAIR_HOST_TEST"] === "1";

/**
 * A confirmation port that auto-approves verification during the isolated host
 * smoke test, where no developer is present to answer a modal. It is only ever
 * selected when the `ADAPTIVE_PAIR_HOST_TEST` flag is set, and never in a
 * released build, where {@link VscodeConfirmationPort} shows the real modal.
 */
class HostTestAutoConfirmPort implements ConfirmationPort {
  public confirm(request: ConfirmationRequest, signal: AbortSignal): Promise<boolean> {
    void request;
    return Promise.resolve(!signal.aborted);
  }
}

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
  const hostTest = isHostTest();
  const ledger = new ActivityLedger();

  const confirmation: ConfirmationPort = hostTest
    ? new HostTestAutoConfirmPort()
    : new VscodeConfirmationPort();
  const resolveVerification = (): VerificationRunner | undefined => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (root === undefined) {
      return undefined;
    }
    return createVerificationAdapter(root, undefined, confirmation);
  };
  const effects = new StableEffectPort({ resolveVerification });

  const sessionController = new SessionController({ effects, ledger });
  const statusView = new StatusView();
  const toolContext = new PairToolContext();
  const presenceController = new PresenceController(
    sessionController,
    statusView,
    toolContext,
    { ledger },
  );

  presenceController.register(context);

  const coordinator = sessionController.coordinator();
  registerPairTools(context, coordinator);

  const growthParticipant = new GrowthParticipant({
    coordinator,
    consent: new ModelConsentRegistry(),
    evaluations: new GrowthEvaluationLog(),
    createModel: model => {
      const growthModel = createGrowthModel(model, coordinator);
      return {
        request: (instructions, tools, signal) => {
          ledger.recordModelRequest();
          return growthModel.request(instructions, tools, signal);
        },
      };
    },
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

  const api: { getState: AdaptivePairExtensionApi["getState"] } & Record<string, unknown> = {
    getState: () => presenceController.getState(),
  };

  if (hostTest) {
    api["__pairHostTest"] = createHostTestApi({
      coordinator,
      ledger,
      presenceController,
      context,
    });
  }

  return Object.freeze(api);
};

export const deactivate = (): void => {};
