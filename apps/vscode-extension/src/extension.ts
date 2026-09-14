import type { ExtensionContext } from "vscode";
import {
  PresenceController,
  type AdaptivePairExtensionApi,
} from "./presenceController.js";
import { SessionController } from "./sessionController.js";
import { StatusView } from "./statusView.js";
import { PairToolContext } from "./tools/pairToolContext.js";
import { registerPairTools } from "./tools/registerPairTools.js";

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
  registerPairTools(context, sessionController.coordinator());

  return Object.freeze({
    getState: () => presenceController.getState(),
  });
};

export const deactivate = (): void => {};
