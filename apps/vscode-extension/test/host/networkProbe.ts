/**
 * A real runtime network probe for the isolated Extension Host.
 *
 * Adaptive Pair has no production network boundary, so "zero network activity"
 * cannot be proved by an in-process counter that nothing ever increments.
 * Instead the smoke test wraps the actual outbound entry points available to an
 * extension — the global `fetch` and the `http`/`https` `request` and `get`
 * functions — before the extension activates, asserts the wrappers observe
 * nothing during the inactive window, and then proves the wrappers really do
 * count by driving one controlled call through them with the downstream
 * implementation short-circuited, so no traffic is ever emitted.
 */
export type NetworkCall = (...args: unknown[]) => unknown;

export interface HttpModuleLike {
  request: NetworkCall;
  get: NetworkCall;
}

export interface NetworkProbeTarget {
  /** The object that owns the global `fetch` binding (normally `globalThis`). */
  readonly globals: { fetch?: NetworkCall };
  readonly http: HttpModuleLike;
  readonly https: HttpModuleLike;
}

export type NetworkProbeLabel =
  | "fetch"
  | "http.request"
  | "http.get"
  | "https.request"
  | "https.get";

export interface ControlledCallProof {
  readonly before: number;
  readonly after: number;
  readonly labels: readonly NetworkProbeLabel[];
}

interface InstalledOriginals {
  readonly fetch: NetworkCall | undefined;
  readonly httpRequest: NetworkCall;
  readonly httpGet: NetworkCall;
  readonly httpsRequest: NetworkCall;
  readonly httpsGet: NetworkCall;
}

const INERT_RESULT = Object.freeze({
  adaptivePairControlledProbe: true,
});

export class NetworkProbe {
  private originals: InstalledOriginals | undefined;
  private readonly observed: NetworkProbeLabel[] = [];
  private shortCircuit = false;

  public constructor(private readonly target: NetworkProbeTarget) {}

  public get count(): number {
    return this.observed.length;
  }

  public get calls(): readonly NetworkProbeLabel[] {
    return [...this.observed];
  }

  public install(): void {
    if (this.originals !== undefined) {
      throw new Error("The network probe is already installed.");
    }

    this.originals = {
      fetch: this.target.globals.fetch,
      httpRequest: this.target.http.request,
      httpGet: this.target.http.get,
      httpsRequest: this.target.https.request,
      httpsGet: this.target.https.get,
    };

    if (this.originals.fetch !== undefined) {
      this.target.globals.fetch = this.wrap("fetch", this.originals.fetch);
    }
    this.target.http.request = this.wrap("http.request", this.originals.httpRequest);
    this.target.http.get = this.wrap("http.get", this.originals.httpGet);
    this.target.https.request = this.wrap("https.request", this.originals.httpsRequest);
    this.target.https.get = this.wrap("https.get", this.originals.httpsGet);
  }

  public restore(): void {
    const originals = this.originals;
    if (originals === undefined) {
      throw new Error("The network probe is not installed.");
    }

    if (originals.fetch === undefined) {
      delete this.target.globals.fetch;
    } else {
      this.target.globals.fetch = originals.fetch;
    }
    this.target.http.request = originals.httpRequest;
    this.target.http.get = originals.httpGet;
    this.target.https.request = originals.httpsRequest;
    this.target.https.get = originals.httpsGet;
    this.originals = undefined;
  }

  /**
   * Drive one call through every installed wrapper with the downstream
   * implementation short-circuited. The counting path is exactly the one a real
   * outbound call would take, but nothing leaves the process.
   */
  public proveCountsWithoutNetwork(): ControlledCallProof {
    if (this.originals === undefined) {
      throw new Error("The network probe is not installed.");
    }

    const before = this.count;
    this.shortCircuit = true;
    try {
      const probeUrl = "https://adaptive-pair.invalid/controlled-probe";
      const invoke = (call: NetworkCall | undefined): void => {
        call?.(probeUrl);
      };
      invoke(this.target.globals.fetch);
      invoke(this.target.http.request);
      invoke(this.target.http.get);
      invoke(this.target.https.request);
      invoke(this.target.https.get);
    } finally {
      this.shortCircuit = false;
    }

    return {
      before,
      after: this.count,
      labels: this.observed.slice(before),
    };
  }

  private wrap(label: NetworkProbeLabel, original: NetworkCall): NetworkCall {
    const observed = this.observed;
    const shortCircuited = (): boolean => this.shortCircuit;
    return function wrapped(this: unknown, ...args: unknown[]): unknown {
      observed.push(label);
      if (shortCircuited()) {
        return INERT_RESULT;
      }
      return Reflect.apply(original, this, args);
    };
  }
}
