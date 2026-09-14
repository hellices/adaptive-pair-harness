import * as vscode from "vscode";
import type { ExtensionContext } from "vscode";
import type { PairCoordinatorPort } from "@adaptive-pair/runtime";
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
import { accountedModelFactory } from "./modelAccounting.js";
import { ActivityLedger } from "./activityLedger.js";
import { StableEffectPort, type VerificationRunner } from "./stableEffectPort.js";
import {
  createVerificationAdapter,
  VscodeConfirmationPort,
  type ConfirmationPort,
} from "./verificationAdapter.js";

export const GROWTH_PARTICIPANT_ID = "adaptivePair.chat";

/**
 * Everything one activation wires together. The production entry point exposes
 * only {@link ExtensionRuntime.api}; the isolated host-test entry point (which
 * is never bundled into a released build) uses the remaining members to drive
 * the same real runtime deterministically.
 */
export interface ExtensionRuntime {
  readonly api: AdaptivePairExtensionApi;
  readonly coordinator: PairCoordinatorPort;
  readonly ledger: ActivityLedger;
  readonly presenceController: PresenceController;
  readonly sessionController: SessionController;
  readonly growthParticipant: GrowthParticipant;
}

export interface ExtensionRuntimeOptions {
  /**
   * Overrides the verification confirmation surface. Production always uses the
   * real modal {@link VscodeConfirmationPort}.
   */
  readonly confirmation?: ConfirmationPort;
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

/**
 * Build and register the complete Adaptive Pair runtime for one activation.
 *
 * This is the single production wiring used by both entry points, so the
 * isolated Extension Host smoke exercises exactly the shipped behavior.
 */
export const createExtensionRuntime = (
  context: ExtensionContext,
  options: ExtensionRuntimeOptions = {},
): ExtensionRuntime => {
  const ledger = new ActivityLedger();
  const confirmation: ConfirmationPort =
    options.confirmation ?? new VscodeConfirmationPort();

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
    createModel: accountedModelFactory(ledger, model => createGrowthModel(model, coordinator)),
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

  return {
    api: Object.freeze({ getState: () => presenceController.getState() }),
    coordinator,
    ledger,
    presenceController,
    sessionController,
    growthParticipant,
  };
};
