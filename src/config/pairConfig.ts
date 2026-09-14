import type * as vscode from "vscode";
import type { TokenBudgetConfig } from "../core/tokenBudget";
import { parseSafeRemoteEndpoint } from "../core/remoteEndpoint";

export {
  apiKeySecretNameForEndpoint,
  canonicalEndpointOrigin,
} from "../core/remoteEndpoint";

export type PairProvider =
  | "local-template"
  | "vscode-copilot"
  | "openai-compatible";

export interface PairConfig {
  readonly enabled: boolean;
  readonly debounceMs: number;
  readonly interventionStyle: "eco" | "balanced" | "active";
  readonly provider: PairProvider;
  readonly chatMode?: "workspace-agent" | "local-only";
  readonly baseUrl: URL | undefined;
  readonly modelName: string;
  readonly budget: TokenBudgetConfig;
  readonly statusWarning: string | undefined;
}

export interface ConfigurationReader {
  get(key: string): unknown;
  inspect?(key: string): ConfigurationInspection | undefined;
}

export interface ConfigurationInspection {
  readonly defaultValue?: unknown;
  readonly globalValue?: unknown;
  readonly workspaceValue?: unknown;
  readonly workspaceFolderValue?: unknown;
  readonly defaultLanguageValue?: unknown;
  readonly globalLanguageValue?: unknown;
  readonly workspaceLanguageValue?: unknown;
  readonly workspaceFolderLanguageValue?: unknown;
}

const STYLE_BUDGETS = {
  eco: {
    maxCalls: 2,
    maxInputTokens: 12_000,
    maxOutputTokens: 1_200,
    maxOutputTokensPerCall: 180,
    maxOutputTokensPerChatCall: 600,
    windowMs: 600_000,
  },
  balanced: {
    maxCalls: 4,
    maxInputTokens: 24_000,
    maxOutputTokens: 2_400,
    maxOutputTokensPerCall: 180,
    maxOutputTokensPerChatCall: 600,
    windowMs: 600_000,
  },
  active: {
    maxCalls: 8,
    maxInputTokens: 48_000,
    maxOutputTokens: 4_800,
    maxOutputTokensPerCall: 180,
    maxOutputTokensPerChatCall: 600,
    windowMs: 600_000,
  },
} as const;

const DEFAULT_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_MODEL_NAME = "qwen2.5-coder:7b";

export const budgetForInterventionStyle = (
  style: PairConfig["interventionStyle"],
): TokenBudgetConfig => STYLE_BUDGETS[style];

export function readPairConfig(workspace: vscode.WorkspaceConfiguration): PairConfig;
export function readPairConfig(workspace: ConfigurationReader): PairConfig;
export function readPairConfig(workspace: ConfigurationReader): PairConfig {
  const configuredDebounce = workspace.get("debounceMs");
  const debounceMs =
    typeof configuredDebounce === "number" && Number.isFinite(configuredDebounce)
      ? Math.min(800, Math.max(300, configuredDebounce))
      : 500;
  const configuredStyle = workspace.get("interventionStyle");
  const interventionStyle =
    configuredStyle === "eco" ||
    configuredStyle === "balanced" ||
    configuredStyle === "active"
      ? configuredStyle
      : "balanced";
  const providerSetting = readApplicationSetting(workspace, "model.provider");
  const configuredProvider = providerSetting.value;
  const validProvider =
    configuredProvider === "vscode-copilot" ||
    configuredProvider === "openai-compatible" ||
    configuredProvider === "local-template";
  let provider: PairProvider = validProvider
    ? configuredProvider
    : "local-template";
  const baseUrlSetting = readApplicationSetting(workspace, "model.baseUrl");
  const configuredBaseUrl = baseUrlSetting.value;
  const baseUrl =
    configuredBaseUrl === undefined
      ? parseSafeRemoteEndpoint(DEFAULT_BASE_URL)
      : typeof configuredBaseUrl === "string"
        ? parseSafeRemoteEndpoint(configuredBaseUrl)
        : undefined;
  const warnings: string[] = [];
  const chatModeSetting = readApplicationSetting(workspace, "chat.mode");
  const chatMode: NonNullable<PairConfig["chatMode"]> = chatModeSetting.value === undefined || chatModeSetting.value === "workspace-agent"
    ? "workspace-agent" : "local-only";
  if (chatModeSetting.ignoredWorkspaceOverride) {
    warnings.push("Unsafe workspace Chat mode ignored; using the application setting.");
  }
  if (chatModeSetting.value !== undefined && chatModeSetting.value !== "workspace-agent" && chatModeSetting.value !== "local-only") {
    warnings.push("Unknown interactive Chat mode; using local-only.");
  }
  if (
    providerSetting.ignoredWorkspaceOverride ||
    baseUrlSetting.ignoredWorkspaceOverride
  ) {
    warnings.push("Unsafe workspace remote settings ignored; using application settings.");
  }
  if (configuredProvider !== undefined && !validProvider) {
    warnings.push(
      `Unknown model provider "${String(configuredProvider)}"; using local-template.`,
    );
  } else if (provider === "openai-compatible" && baseUrl === undefined) {
    provider = "local-template";
    warnings.push(
      "OpenAI-compatible provider disabled: adaptivePair.model.baseUrl is invalid or unsafe.",
    );
  }
  const modelNameSetting = readApplicationSetting(workspace, "model.name");
  if (modelNameSetting.ignoredWorkspaceOverride) {
    warnings.push("Unsafe workspace remote settings ignored; using application settings.");
  }
  const configuredModelName = modelNameSetting.value;
  const modelName =
    typeof configuredModelName === "string" && configuredModelName.trim().length > 0
      ? configuredModelName.trim()
      : DEFAULT_MODEL_NAME;

  return {
    enabled: workspace.get("enabled") !== false,
    debounceMs,
    interventionStyle,
    provider,
    chatMode,
    baseUrl,
    modelName,
    budget: budgetForInterventionStyle(interventionStyle),
    statusWarning:
      warnings.length === 0 ? undefined : [...new Set(warnings)].join(" "),
  };
}

interface ApplicationSetting {
  readonly value: unknown;
  readonly ignoredWorkspaceOverride: boolean;
}

const readApplicationSetting = (
  workspace: ConfigurationReader,
  key: string,
): ApplicationSetting => {
  const inspected = workspace.inspect?.(key);
  if (inspected === undefined) {
    return {
      value: workspace.get(key),
      ignoredWorkspaceOverride: false,
    };
  }

  return {
    value:
      inspected.globalLanguageValue ??
      inspected.globalValue ??
      inspected.defaultLanguageValue ??
      inspected.defaultValue,
    ignoredWorkspaceOverride:
      inspected.workspaceValue !== undefined ||
      inspected.workspaceFolderValue !== undefined ||
      inspected.workspaceLanguageValue !== undefined ||
      inspected.workspaceFolderLanguageValue !== undefined,
  };
};
