import type { DurableCommit } from "@adaptive-pair/protocol";
import type {
  DurableEraseResult, DurableReadResult, DurableStore, DurableWriteResult,
} from "../src/durableStore.js";
import {
  copyModelCommit, prepareModelAppend, prepareModelCreate, requireGeneration, type PreparedHead,
} from "./durableStorePreparation.js";
import {
  failModel, hasOwnedCopies, inspectModel, modelFailureCode, modelKey, modelTextBytes, readModelControl, validateModelMetadata,
  type ModelControl, type ModelMedium,
} from "./durableStoreState.js";

export { modelMedium, type ModelCopy, type ModelMedium } from "./durableStoreState.js";

export type ModelFault =
  | "before-head-publication" | "after-publication" | "during-cleanup" | "after-cleanup" | "after-erased-publication";
export type ModelBoundary = "before-compare" | "before-publish";
export type ModelOperation = "create" | "append" | "erase";

interface ModelOptions {
  readonly fault?: ModelFault;
  readonly hook?: (boundary: ModelBoundary, operation: ModelOperation) => Promise<void>;
}

export class DurableStoreModel implements DurableStore {
  private fault: ModelFault | undefined;

  public constructor(
    private readonly namespaceKey: string,
    private readonly medium: ModelMedium,
    private readonly options: ModelOptions = {},
  ) {
    if (!modelKey(namespaceKey)) failModel("INVALID_REQUEST");
    this.fault = options.fault;
  }

  public load(): Promise<DurableReadResult> {
    try {
      const view = inspectModel(this.medium, this.namespaceKey);
      const result: DurableReadResult = view.state === "present" ? { status: "present", text: view.text }
        : view.state === "erased" ? { status: "erased", generationKey: view.control.generationKey } : { status: "empty" };
      return Promise.resolve(Object.freeze(result));
    } catch {
      return Promise.resolve(Object.freeze({ status: "blocked" }));
    }
  }

  public async create(text: string, expectedGenerationKey: string | null): Promise<DurableWriteResult> {
    try {
      await this.pause("before-compare", "create");
      const compared = this.medium.control;
      prepareModelCreate(inspectModel(this.medium, this.namespaceKey), this.namespaceKey, text, expectedGenerationKey);
      await this.pause("before-publish", "create");
      const head = prepareModelCreate(inspectModel(this.medium, this.namespaceKey), this.namespaceKey, text, expectedGenerationKey);
      if (this.medium.control !== compared) return failModel("HEAD_CONFLICT");
      return this.publish(head);
    } catch (error) {
      return Object.freeze({ status: "not-committed", code: modelFailureCode(error) });
    }
  }

  public async append(generationKey: string, commit: DurableCommit): Promise<DurableWriteResult> {
    try {
      const initial = requireGeneration(inspectModel(this.medium, this.namespaceKey), generationKey);
      const request = copyModelCommit(initial.journal, commit);
      await this.pause("before-compare", "append");
      const compared = this.medium.control;
      const prepared = prepareModelAppend(inspectModel(this.medium, this.namespaceKey), generationKey, request);
      if (prepared.kind === "retry") return prepared.result;
      await this.pause("before-publish", "append");
      const current = prepareModelAppend(inspectModel(this.medium, this.namespaceKey), generationKey, request);
      if (current.kind === "retry") return current.result;
      if (this.medium.control !== compared) return failModel("HEAD_CONFLICT");
      return this.publish(current.head);
    } catch (error) {
      return Object.freeze({ status: "not-committed", code: modelFailureCode(error) });
    }
  }

  public async erase(generationKey: string): Promise<DurableEraseResult> {
    try {
      await this.pause("before-compare", "erase");
      this.erasureControl(generationKey);
      await this.pause("before-publish", "erase");
      const current = this.erasureControl(generationKey);
      if (current.state === "erased" && !hasOwnedCopies(this.medium, this.namespaceKey)) {
        return Object.freeze({ status: "erased" });
      }
      const fence: ModelControl = Object.freeze({
        format: "adaptive-pair-durable", version: 1, state: "erasing", namespaceKey: this.namespaceKey, generationKey,
        retiredGenerationKeys: Object.freeze([...current.retiredGenerationKeys]),
      });
      this.medium.control = fence;
      if (this.takeFault("after-publication")) return Object.freeze({ status: "indeterminate" });
      return this.cleanup(fence);
    } catch (error) {
      return Object.freeze({ status: "not-erased", code: modelFailureCode(error) });
    }
  }

  private erasureControl(generationKey: string): ModelControl {
    if (!modelKey(generationKey)) return failModel("INVALID_REQUEST");
    validateModelMetadata(this.medium);
    const control = readModelControl(this.medium, this.namespaceKey);
    if (control === null || control.generationKey !== generationKey) return failModel("GENERATION_CONFLICT");
    if (this.medium.copies.some(copy => copy.namespaceKey !== this.namespaceKey)) return failModel("BINDING_MISMATCH");
    return control;
  }

  private publish(head: PreparedHead): DurableWriteResult {
    if (this.medium.nextCopyKey > Number.MAX_SAFE_INTEGER - 2) return failModel("LIMIT_EXCEEDED");
    modelTextBytes(head.text);
    modelTextBytes(head.cacheText);
    const copyKey = this.medium.nextCopyKey++;
    const staged = {
      copyKey, namespaceKey: this.namespaceKey, generationKey: head.journal.generationKey, kind: "staged" as const, text: head.text,
    };
    this.medium.copies = [...this.medium.copies.filter(copy => copy.kind !== "staged"), staged];
    if (this.takeFault("before-head-publication")) return Object.freeze({ status: "indeterminate" });
    const cache = { ...staged, copyKey: this.medium.nextCopyKey++, kind: "cache" as const, text: head.cacheText };
    const payload = { ...staged, kind: "payload" as const };
    const control: ModelControl = Object.freeze({
      format: "adaptive-pair-durable", version: 1, state: "present", namespaceKey: this.namespaceKey,
      generationKey: head.journal.generationKey,
      headSequence: head.journal.headSequence, payloadKey: copyKey, retiredGenerationKeys: head.retiredGenerationKeys,
    });
    this.medium.copies = [payload, cache];
    this.medium.control = control;
    return this.takeFault("after-publication") ? Object.freeze({ status: "indeterminate" })
      : Object.freeze({ status: "committed", receipt: head.receipt });
  }

  private cleanup(fence: ModelControl): DurableEraseResult {
    const first = this.medium.copies.find(copy => copy.namespaceKey === this.namespaceKey);
    if (first !== undefined) this.medium.copies = this.medium.copies.filter(copy => copy !== first);
    if (this.takeFault("during-cleanup")) return Object.freeze({ status: "cleanup-pending" });
    this.medium.copies = this.medium.copies.filter(copy => copy.namespaceKey !== this.namespaceKey);
    if (hasOwnedCopies(this.medium, this.namespaceKey) || this.takeFault("after-cleanup")) {
      return Object.freeze({ status: "cleanup-pending" });
    }
    this.medium.control = Object.freeze({ ...fence, state: "erased" });
    return Object.freeze({ status: this.takeFault("after-erased-publication") ? "indeterminate" : "erased" });
  }

  private takeFault(point: ModelFault): boolean {
    if (this.fault !== point) return false;
    this.fault = undefined;
    return true;
  }

  private pause(boundary: ModelBoundary, operation: ModelOperation): Promise<void> {
    return this.options.hook?.(boundary, operation) ?? Promise.resolve();
  }
}
