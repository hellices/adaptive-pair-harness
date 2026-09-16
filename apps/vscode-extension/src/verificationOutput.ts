import { StringDecoder } from "node:string_decoder";
import type { EffectResult } from "@adaptive-pair/runtime";
import type { RunOutcome } from "./verificationContracts.js";
import { boundEffectResultText } from "./effectResultBudget.js";

export const MAX_OUTPUT_BYTES = 128 * 1024;

export const DISPLAY_LIMIT = 16_000;

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN[A-Z ]*PRIVATE KEY-----/u,
  /AKIA[0-9A-Z]{16}/u,
  /gh[posru]_[A-Za-z0-9]{20,}/u,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u,
  /\bBearer\s+[A-Za-z0-9._-]{16,}/u,
  /(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*\S+/iu,
];

const containsSensitive = (text: string): boolean =>
  SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));

const boundToBytes = (text: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } => {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return { text, truncated: false };
  }
  return { text: boundedUtf8(buffer, maxBytes), truncated: true };
};

/**
 * Decode at most `maxBytes` of a UTF-8 buffer without emitting a trailing
 * replacement character. `StringDecoder` buffers an incomplete trailing
 * multibyte sequence internally instead of flushing it as U+FFFD, so slicing at
 * an arbitrary byte boundary drops only the partial code point cleanly.
 */
const boundedUtf8 = (buffer: Buffer, maxBytes: number): string => {
  const decoder = new StringDecoder("utf8");
  return decoder.write(buffer.subarray(0, Math.min(buffer.byteLength, maxBytes)));
};

export class VerificationOutputBuffer {
  private readonly chunks: Buffer[] = [];
  private byteLength = 0;
  private outputTruncated = false;

  public readonly collect = (data: Buffer): void => {
    const remaining = MAX_OUTPUT_BYTES - this.byteLength;
    if (remaining <= 0) {
      this.outputTruncated = true;
      return;
    }
    if (data.byteLength > remaining) {
      this.chunks.push(data.subarray(0, remaining));
      this.byteLength += remaining;
      this.outputTruncated = true;
      return;
    }
    this.byteLength += data.byteLength;
    this.chunks.push(data);
  };

  public read(): Pick<RunOutcome, "output" | "outputTruncated"> {
    return {
      output: boundedUtf8(Buffer.concat(this.chunks), MAX_OUTPUT_BYTES),
      outputTruncated: this.outputTruncated,
    };
  }
}

const summarize = (
  status: EffectResult["status"],
  passed: boolean,
  timedOut: boolean,
): string => {
  switch (status) {
    case "confirmed":
      return passed ? "Verification ran and the check passed." : "Verification ran and the check failed.";
    case "cancelled":
      return timedOut
        ? "Verification exceeded the 120-second cap and was terminated."
        : "Verification was cancelled.";
    case "unknown":
      return "Verification was interrupted and process termination could not be confirmed.";
    default:
      return "Verification did not complete.";
  }
};

export const interpretVerificationOutcome = (
  operationId: string,
  outcome: RunOutcome,
  aborted: boolean,
  deadlineFired: boolean,
): EffectResult => {
  const bounded = boundToBytes(outcome.output, MAX_OUTPUT_BYTES);
  const sensitive = containsSensitive(bounded.text);
  const display = sensitive
    ? "[redacted: potential secret detected in verification output]"
    : bounded.text;

  // Only the adapter's own 120s deadline sets timedOut. A manual caller
  // cancellation aborts the same controller but must never be labelled a
  // timeout.
  const interrupted = aborted;
  const timedOut = deadlineFired;

  let status: EffectResult["status"];
  if (interrupted) {
    status = outcome.terminationConfirmed ? "cancelled" : "unknown";
  } else if (outcome.exitCode === null) {
    status = "failed";
  } else {
    status = "confirmed";
  }

  const passed = status === "confirmed" && outcome.exitCode === 0;
  const partial =
    interrupted || outcome.outputTruncated || bounded.truncated;

  const observation: Record<string, unknown> = {
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut,
    terminationConfirmed: outcome.terminationConfirmed,
  };
  if (status === "confirmed") {
    observation["passed"] = passed;
  }

  return boundEffectResultText(display, DISPLAY_LIMIT, output => ({
    operationId,
    status,
    summary: summarize(status, passed, timedOut),
    observation: {
      ...observation,
      output,
      outputTruncatedForDisplay: !sensitive && output.length < bounded.text.length,
    },
    sensitiveData: sensitive,
    partial,
  }));
};
