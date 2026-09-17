import { SessionTargetStore, type SessionTargetRecord } from "./sessionTargetStore";

export class SessionTargetProviderCore {
  public constructor(
    private readonly store: SessionTargetStore,
    private readonly now: () => number,
  ) {}

  public create(prompt: string): SessionTargetRecord {
    return this.store.create(prompt, this.now());
  }

  public resolveForRequest(
    resource: string | undefined,
    prompt: string,
  ): SessionTargetRecord {
    if (resource === undefined) {
      return this.create(prompt);
    }
    const session = this.store.get(resource);
    if (session === undefined) {
      throw new Error(`Unknown Adaptive Pair session: ${resource}`);
    }
    return session;
  }

  public respond(
    resource: string,
    prompt: string,
    signal: AbortSignal,
    write: (chunk: string) => void,
  ): Promise<void> {
    return new Promise<void>(resolve => {
      if (this.store.get(resource) === undefined) {
        throw new Error(`Unknown Adaptive Pair session: ${resource}`);
      }
      try {
        signal.throwIfAborted();
        write("Adaptive Pair Session Target is active.\n");
        signal.throwIfAborted();
        write(`Request: ${prompt}`);
        this.store.setStatus(resource, "completed");
      } catch (error: unknown) {
        this.store.setStatus(resource, signal.aborted ? "needs-input" : "failed");
        throw error;
      }
      resolve();
    });
  }
}
