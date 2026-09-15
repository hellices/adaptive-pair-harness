export interface SessionTargetRecord {
  readonly id: string;
  readonly resource: string;
  readonly title: string;
  readonly createdAt: number;
  readonly status: "in-progress" | "completed" | "failed" | "needs-input";
}

export class SessionTargetStore {
  private readonly records = new Map<string, SessionTargetRecord>();

  public constructor(private readonly nextId: () => string) {}

  public create(prompt: string, createdAt: number): SessionTargetRecord {
    const id = this.nextId();
    const record = Object.freeze({
      id,
      resource: `adaptive-pair:/sessions/${id}`,
      title: prompt.trim(),
      createdAt,
      status: "in-progress" as const,
    });
    this.records.set(record.resource, record);
    return record;
  }

  public get(resource: string): SessionTargetRecord | undefined {
    return this.records.get(resource);
  }

  public setStatus(
    resource: string,
    status: SessionTargetRecord["status"],
  ): SessionTargetRecord {
    const current = this.records.get(resource);
    if (current === undefined) {
      throw new Error(`Unknown Adaptive Pair session: ${resource}`);
    }
    const updated = Object.freeze({ ...current, status });
    this.records.set(resource, updated);
    return updated;
  }

  public list(): readonly SessionTargetRecord[] {
    return Object.freeze([...this.records.values()]);
  }
}
