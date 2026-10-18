import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

type Scan = (payload: unknown, provider: string) => Promise<unknown>;
let scan: Scan | undefined;
/** Installed before any workspace session starts. Lookup is late-bound for every send. */
export function configureOutboundRedaction(value: Scan): void { scan = value; }

type PayloadHook = NonNullable<NonNullable<Parameters<ModelRuntime["streamSimple"]>[2]>["onPayload"]>;

export function protectModelRuntime(runtime: Pick<ModelRuntime, "stream" | "streamSimple">, scanner?: Scan): void {
  const onPayload = (previous: PayloadHook | undefined): PayloadHook | undefined => {
    const filter = scanner ?? scan;
    if (!filter) return previous;
    // This runs in the provider after extensions and payload construction. Unlike
    // before_provider_request, a rejected callback aborts the provider request.
    return async (payload, selected) => {
      try {
        const next = await previous?.(payload, selected);
        const redacted = await filter(next === undefined ? payload : next, selected.provider);
        if (redacted === undefined) throw new Error();
        return redacted;
      } catch { throw new Error("Credential scan failed; model request blocked."); }
    };
  };
  // Assign separately to preserve stream's API-specific generic options signature.
  const stream = runtime.stream.bind(runtime);
  runtime.stream = (model, context, options) => stream(model, context, Object.assign({}, options, { onPayload: onPayload(options?.onPayload) }));
  const streamSimple = runtime.streamSimple.bind(runtime);
  runtime.streamSimple = (model, context, options) => streamSimple(model, context, { ...options, onPayload: onPayload(options?.onPayload) });
}
