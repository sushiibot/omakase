import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineDocFamily, type Session } from "@earendil-works/pi-durable";
import type { DurableState } from "../agentRuntime/durableState.ts";
import type { ChatOrigin } from "../orchestration/contracts.ts";

export type PendingOwnerAsk = { askId: string; origin?: ChatOrigin };
const PendingAsks = defineDocFamily({
  kind: "sushii.pending-owner-asks", version: 1, scope: "session", family: true,
  initial: (_seed: null) => ({ asks: [] as PendingOwnerAsk[] }),
});

/** Crash-recovery handles only. Live promises and answers remain owned by ChatAsks. */
export class PendingOwnerAsks {
  private session?: Session;
  private opening?: Promise<void>;
  private changes: Promise<void> = Promise.resolve();
  constructor(private readonly store: DurableState, private readonly conversationId: string) {}
  async open(): Promise<void> {
    this.opening ??= (async () => {
      this.session = await this.store.open();
      await this.session.commit(async tx => { await tx.doc(PendingAsks, this.conversationId, null); }, BACKGROUND_CONTEXT);
    })();
    await this.opening;
  }
  async list(): Promise<PendingOwnerAsk[]> {
    await this.open(); await this.changes;
    return (await this.session!.snapshot(PendingAsks, this.conversationId, BACKGROUND_CONTEXT))!.asks.map(ask => structuredClone(ask));
  }
  prepare(ask: PendingOwnerAsk): Promise<void> {
    return this.change(async tx => {
      const doc = await tx.doc(PendingAsks, this.conversationId, null);
      if (!doc.asks.some(a => a.askId === ask.askId)) doc.asks.push(JSON.parse(JSON.stringify(ask)));
    });
  }
  retire(askId: string): Promise<void> {
    return this.change(async tx => {
      const doc = await tx.doc(PendingAsks, this.conversationId, null);
      doc.asks = doc.asks.filter(ask => ask.askId !== askId);
    });
  }
  private change(mutator: Parameters<Session["commit"]>[0]): Promise<void> {
    const changed = this.changes.then(async () => { await this.open(); await this.session!.commit(mutator, BACKGROUND_CONTEXT); });
    this.changes = changed.catch(() => {});
    return changed;
  }
  async flush(): Promise<void> { await this.changes; }
}
