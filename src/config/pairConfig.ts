import type * as vscode from "vscode";
import type { TokenBudgetConfig } from "../core/tokenBudget";

export type PairProvider =
  | "local-template"
  | "vscode-copilot"
  | "openai-compatible";

export interface PairConfig {
  readonly enabled: boolean;
  readonly debounceMs: number;
  readonly interventionStyle: "eco" | "balanced" | "active";
  readonly provider: PairProvider;
  readonly baseUrl: URL | undefined;
  readonly modelName: string;
  readonly budget: TokenBudgetConfig;
  readonly statusWarning: string | undefined;
}

export interface ConfigurationReader {
  get(key: string): unknown;
}

const STYLE_BUDGETS = {
  eco: { maxCalls: 2, maxInputTokens: 2_000, windowMs: 600_000 },
  balanced: { maxCalls: 4, maxInputTokens: 6_000, windowMs: 600_000 },
  active: { maxCalls: 8, maxInputTokens: 12_000, windowMs: 600_000 },
} as const;

const DEFAULT_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_MODEL_NAME = "qwen2.5-coder:7b";

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
  const configuredProvider = workspace.get("model.provider");
  let provider: PairProvider =
    configuredProvider === "vscode-copilot" ||
    configuredProvider === "openai-compatible" ||
    configuredProvider === "local-template"
      ? configuredProvider
      : "local-template";
  const configuredBaseUrl = workspace.get("model.baseUrl");
  const baseUrl = parseUrl(
    typeof configuredBaseUrl === "string" ? configuredBaseUrl : DEFAULT_BASE_URL,
  );
  let statusWarning: string | undefined;
  if (provider === "openai-compatible" && baseUrl === undefined) {
    provider = "local-template";
    statusWarning =
      "OpenAI-compatible provider disabled: adaptivePair.model.baseUrl is invalid.";
  }
  const configuredModelName = workspace.get("model.name");
  const modelName =
    typeof configuredModelName === "string" && configuredModelName.trim().length > 0
      ? configuredModelName.trim()
      : DEFAULT_MODEL_NAME;

  return {
    enabled: workspace.get("enabled") !== false,
    debounceMs,
    interventionStyle,
    provider,
    baseUrl,
    modelName,
    budget: STYLE_BUDGETS[interventionStyle],
    statusWarning,
  };
}

const parseUrl = (value: string): URL | undefined => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : undefined;
  } catch (error: unknown) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    return undefined;
  }
};
