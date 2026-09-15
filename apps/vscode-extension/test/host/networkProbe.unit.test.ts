import { describe, expect, it } from "vitest";
import { NetworkProbe, type NetworkProbeTarget } from "./networkProbe.js";

interface FakeTarget extends NetworkProbeTarget {
  readonly delegated: string[];
}

const createTarget = (): FakeTarget => {
  const delegated: string[] = [];
  const record = (label: string) => (): string => {
    delegated.push(label);
    return label;
  };
  return {
    delegated,
    globals: { fetch: record("fetch") },
    http: { request: record("http.request"), get: record("http.get") },
    https: { request: record("https.request"), get: record("https.get") },
  };
};

describe("NetworkProbe", () => {
  it("reports zero before any wrapped call", () => {
    const probe = new NetworkProbe(createTarget());
    probe.install();

    expect(probe.count).toBe(0);
    expect(probe.calls).toEqual([]);

    probe.restore();
  });

  it("counts real calls and still delegates to the original implementation", () => {
    const target = createTarget();
    const probe = new NetworkProbe(target);
    probe.install();

    expect(target.globals.fetch?.("https://example.test")).toBe("fetch");
    expect(target.http.request("http://example.test")).toBe("http.request");
    expect(target.https.get("https://example.test")).toBe("https.get");

    expect(probe.count).toBe(3);
    expect(probe.calls).toEqual(["fetch", "http.request", "https.get"]);
    expect(target.delegated).toEqual(["fetch", "http.request", "https.get"]);

    probe.restore();
  });

  it("counts a controlled call without delegating any network work", () => {
    const target = createTarget();
    const probe = new NetworkProbe(target);
    probe.install();

    const proof = probe.proveCountsWithoutNetwork();

    expect(proof.before).toBe(0);
    expect(proof.after).toBe(5);
    expect(proof.labels).toEqual([
      "fetch",
      "http.request",
      "http.get",
      "https.request",
      "https.get",
    ]);
    // The wrappers counted, but nothing reached the real implementations.
    expect(target.delegated).toEqual([]);
    expect(probe.count).toBe(5);

    probe.restore();
  });

  it("restores the exact original functions", () => {
    const target = createTarget();
    const originals = {
      fetch: target.globals.fetch,
      httpRequest: target.http.request,
      httpGet: target.http.get,
      httpsRequest: target.https.request,
      httpsGet: target.https.get,
    };
    const probe = new NetworkProbe(target);

    probe.install();
    expect(target.http.request).not.toBe(originals.httpRequest);

    probe.restore();
    expect(target.globals.fetch).toBe(originals.fetch);
    expect(target.http.request).toBe(originals.httpRequest);
    expect(target.http.get).toBe(originals.httpGet);
    expect(target.https.request).toBe(originals.httpsRequest);
    expect(target.https.get).toBe(originals.httpsGet);
  });

  it("refuses to double-install or restore without installing", () => {
    const probe = new NetworkProbe(createTarget());

    expect(() => probe.restore()).toThrow(/not installed/u);
    probe.install();
    expect(() => probe.install()).toThrow(/already installed/u);
    probe.restore();
  });
});
