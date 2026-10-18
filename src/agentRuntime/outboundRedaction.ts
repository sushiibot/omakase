import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

type Scan = (payload: unknown, provider: string) => Promise<unknown>;
let scan: Scan | undefined;
/** Installed before any workspace session starts. Lookup is late-bound for every send. */
export function configureOutboundRedaction(value: Scan): void { scan = value; }

export function protectModelRuntime(runtime: Pick<ModelRuntime, "stream" | "streamSimple">, scanner?: Scan): void {
  for (const method of ["stream", "streamSimple"] as const) {
    const original = runtime[method].bind(runtime);
    runtime[method] = ((model, context, options) => {
      const filter = scanner ?? scan;
      if (!filter) return original(model, context, options);
      const previous = options?.onPayload;
      return original(model, context, {
        ...options,
        // This runs in the provider after extensions and payload construction. Unlike
        // before_provider_request, a rejected callback aborts the provider request.
        onPayload: async (payload, selected) => {
          try {
            const next = await previous?.(payload, selected);
            const redacted = await filter(next === undefined ? payload : next, selected.provider);
            if (redacted === undefined) throw new Error();
            return redacted;
          } catch { throw new Error("Credential scan failed; model request blocked."); }
        },
      });
    }) as typeof runtime[typeof method];
  }
}
