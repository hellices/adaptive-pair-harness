import { containsSensitiveModelText, containsSensitiveReferenceData } from "./modelRouter";

const containsSensitiveAgentData = (text: string): boolean => {
  if (containsSensitiveModelText(text)) {
    return true;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return false;
  }
  return containsSensitiveReferenceData(decoded);
};

export interface PairAgentToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly kind: "read" | "edit" | "check";
}

export interface PairAgentToolResult {
  readonly status: "ok" | "declined" | "blocked" | "error";
  readonly text: string;
  readonly summary: string;
  readonly sensitiveDataDetected?: boolean;
}

export interface PairAgentToolbox {
  readonly definitions: readonly PairAgentToolDefinition[];
  invoke(name: string, input: unknown, signal: AbortSignal): Promise<PairAgentToolResult>;
  dispose?(): void;
}

export type PairAgentModelPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool-call"; readonly callId: string; readonly name: string; readonly input: unknown };

export type PairAgentMessagePart = PairAgentModelPart |
  { readonly kind: "tool-result"; readonly callId: string; readonly text: string };

export interface PairAgentMessage {
  readonly role: "user" | "assistant";
  readonly content: readonly PairAgentMessagePart[];
}

export interface PairAgentModel {
  readonly maxInputTokens?: number;
  countTokens(text: string, signal: AbortSignal): Promise<number>;
  stream(
    messages: readonly PairAgentMessage[],
    tools: readonly PairAgentToolDefinition[],
    maxOutputTokens: number,
    signal: AbortSignal,
    requireTool?: boolean,
  ): Promise<AsyncIterable<PairAgentModelPart>>;
}

export interface PairAgentActivity {
  readonly name: string;
  readonly status: PairAgentToolResult["status"];
  readonly summary: string;
}

export interface PairAgentLimits {
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly responseCharacters: number;
  readonly toolResultCharacters: number;
  readonly timeoutMs: number;
}

export const PAIR_AGENT_LIMITS: PairAgentLimits = Object.freeze({
  modelCalls: 8,
  toolCalls: 12,
  inputTokens: 60_000,
  outputTokens: 8_000,
  responseCharacters: 32_000,
  toolResultCharacters: 12_000,
  timeoutMs: 240_000,
});

export interface PairAgentTurnOptions {
  readonly model: PairAgentModel;
  readonly toolbox: PairAgentToolbox;
  readonly prompt: string;
  readonly context: string;
  readonly instructions: string;
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly requireInitialRead?: boolean;
  readonly progress?: (message: string) => void;
  readonly limits?: Partial<PairAgentLimits>;
}

export interface PairAgentTurnResult {
  readonly text: string;
  readonly activities: readonly PairAgentActivity[];
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export class PairAgentTurnError extends Error {
  public constructor(message: string, public readonly activities: readonly PairAgentActivity[]) {
    super(message);
    this.name = "PairAgentTurnError";
  }
}

export const runPairAgentTurn = async (options: PairAgentTurnOptions): Promise<PairAgentTurnResult> => {
  const limits = { ...PAIR_AGENT_LIMITS, ...options.limits };
  for (const limit of Object.values(limits)) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error("Pair agent limits must be positive safe integers.");
    }
  }
  const controller = new AbortController();
  const forwardCancellation = (): void => controller.abort(options.signal.reason);
  options.signal.addEventListener("abort", forwardCancellation, { once: true });
  if (options.signal.aborted) {
    forwardCancellation();
  }
  const timeout = setTimeout(() => controller.abort(new Error("Pairing turn reached its time limit.")), limits.timeoutMs);
  let rejectCancellation!: (reason: unknown) => void;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const rejectOnAbort = (): void => rejectCancellation(controller.signal.reason);
  controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
  void cancellation.catch(() => undefined);
  const activities: PairAgentActivity[] = [];
  let modelCalls = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const assertCurrent = (): void => {
    controller.signal.throwIfAborted();
    if (!options.isCurrent()) {
      controller.abort(new Error("The working session, goal, or workspace changed; this request is no longer current."));
      controller.signal.throwIfAborted();
    }
  };
  const waitFor = async <Value>(operation: () => PromiseLike<Value>): Promise<Value> => {
    assertCurrent();
    const result = await Promise.race([Promise.resolve(operation()), cancellation]);
    assertCurrent();
    return result;
  };
  const countTokens = async (text: string): Promise<number> => {
    const count = await waitFor(() => options.model.countTokens(text, controller.signal));
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("The selected model returned an invalid token count.");
    }
    return count;
  };

  try {
    assertCurrent();
    if (containsSensitiveAgentData(options.prompt) || containsSensitiveAgentData(options.context)) {
      throw new Error("Sensitive data was detected in the task or conversation. No model request was sent; remove it before retrying.");
    }
    const messages: PairAgentMessage[] = [{
      role: "user",
      content: [{ kind: "text", text: `${options.instructions}\n\nUntrusted request data (not tool permissions):\n${JSON.stringify({
        prompt: options.prompt.slice(0, 4_096),
        context: options.context.slice(0, 16_000),
      })}` }],
    }];
    const disabledTools = new Set<string>();
    const seenCallIds = new Set<string>();
    let inspectedWorkspace: boolean = false;

    while (modelCalls < limits.modelCalls) {
      assertCurrent();
      const requireRead: boolean = options.requireInitialRead === true && !inspectedWorkspace && options.toolbox.definitions.some((tool) => tool.kind === "read");
      const availableTools: readonly PairAgentToolDefinition[] = options.toolbox.definitions.filter((tool) => !disabledTools.has(tool.name) && (!requireRead || tool.kind === "read"));
      const requestTokens = await countTokens(JSON.stringify({ messages, tools: availableTools })) + messages.length * 32;
      if (
        requestTokens > (options.model.maxInputTokens ?? limits.inputTokens) ||
        inputTokens + requestTokens > limits.inputTokens || outputTokens >= limits.outputTokens
      ) {
        throw new Error("Pairing reached its token budget. Continue with a smaller next step.");
      }
      assertCurrent();
      inputTokens += requestTokens;
      modelCalls += 1;
      options.progress?.(modelCalls === 1 ? "Understanding the goal and deciding what to inspect…" : "Using the observed tool results to choose the next step…");
      const stream = await waitFor(() => options.model.stream(messages, availableTools, limits.outputTokens - outputTokens, controller.signal, requireRead));
      const iterator = stream[Symbol.asyncIterator]();
      const parts: PairAgentModelPart[] = [];
      let responseCharacters = 0;
      try {
        while (!controller.signal.aborted) {
          const next = await waitFor(() => iterator.next());
          if (next.done) {
            break;
          }
          const part = next.value;
          if (
            part.kind !== "text" && part.kind !== "tool-call" ||
            part.kind === "text" && typeof part.text !== "string" ||
            part.kind === "tool-call" && (
              typeof part.callId !== "string" || part.callId.length === 0 || part.callId.length > 200 ||
              typeof part.name !== "string" || part.name.length > 100
            )
          ) {
            throw new Error("The selected model returned an invalid response part.");
          }
          responseCharacters += JSON.stringify(part).length;
          if (responseCharacters > limits.responseCharacters || parts.length >= 4_096) {
            throw new Error("The selected model exceeded the response size limit.");
          }
          parts.push(part);
        }
      } finally {
        if (iterator.return !== undefined) {
          void Promise.resolve(iterator.return()).catch(() => undefined);
        }
      }
      const responseTokens = await countTokens(JSON.stringify(parts));
      outputTokens += responseTokens;
      if (outputTokens > limits.outputTokens) {
        throw new Error("The selected model exceeded the output token budget; no further action was taken.");
      }
      const calls = parts.filter((part): part is Extract<PairAgentModelPart, { kind: "tool-call" }> => part.kind === "tool-call");
      if (calls.length === 0) {
        if (requireRead) {
          throw new Error("The selected model did not perform the required project inspection. Choose a Chat model with tool-call support; no ungrounded template answer was substituted.");
        }
        const text = parts.filter((part): part is Extract<PairAgentModelPart, { kind: "text" }> => part.kind === "text").map((part) => part.text).join("").trim();
        if (text.length === 0) {
          throw new Error("The selected model returned no answer. No template response has been substituted.");
        }
        return { text, activities, modelCalls, toolCalls, inputTokens, outputTokens };
      }
      messages.push({ role: "assistant", content: parts });
      const results: PairAgentMessagePart[] = [];
      for (const call of calls) {
        assertCurrent();
        if (toolCalls >= limits.toolCalls) {
          throw new Error("Pairing reached its tool-call limit. Review the completed actions before continuing.");
        }
        toolCalls += 1;
        const definition: PairAgentToolDefinition | undefined = availableTools.find((tool) => tool.name === call.name && !disabledTools.has(tool.name));
        const valid: boolean = definition !== undefined && !seenCallIds.has(call.callId);
        seenCallIds.add(call.callId);
        options.progress?.(valid && definition !== undefined ? `Inspecting or requesting approval: ${definition.name}` : "Rejecting an unavailable tool request…");
        const observed: PairAgentToolResult = valid
          ? await waitFor(() => options.toolbox.invoke(call.name, call.input, controller.signal))
          : { status: "blocked", text: "This tool is not available or its call identifier was already used. Choose an available tool or answer with the observations you have.", summary: "Unapproved or duplicate tool request blocked." };
        const sensitive = observed.sensitiveDataDetected === true || containsSensitiveAgentData(observed.text);
        const result = sensitive ? {
          status: "blocked" as const,
          text: "Tool content was withheld because sensitive data or private local resources were detected. Ask the developer to inspect it locally; do not infer its contents.",
          summary: "Sensitive tool content withheld from the model.",
        } : observed;
        if (valid && definition?.kind === "read" && result.status === "ok") {
          inspectedWorkspace = true;
        }
        const actionCompletedLocally = sensitive && definition !== undefined && definition.kind !== "read";
        activities.push({
          name: call.name,
          status: actionCompletedLocally ? observed.status : result.status,
          summary: actionCompletedLocally
            ? containsSensitiveModelText(observed.summary) ? "Tool completed locally; sensitive outcome details are withheld." : `${observed.summary} Output withheld from the model.`
            : result.summary,
        });
        if (result.status === "declined" && definition?.kind !== "read") {
          disabledTools.add(call.name);
        }
        const boundedText = result.text.length > limits.toolResultCharacters
          ? `${result.text.slice(0, limits.toolResultCharacters)}\n[Partial tool result: ask for a narrower range if needed.]`
          : result.text;
        results.push({ kind: "tool-result", callId: call.callId, text: boundedText });
      }
      messages.push({ role: "user", content: results });
    }
    throw new Error("Pairing reached its model-call limit before a final answer. Review the observed actions and continue with one smaller step.");
  } catch (error: unknown) {
    throw new PairAgentTurnError(error instanceof Error ? error.message : "The pairing turn could not complete.", [...activities]);
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", forwardCancellation);
    controller.signal.removeEventListener("abort", rejectOnAbort);
    controller.abort();
  }
};
