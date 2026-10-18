import type { ToolContribution } from "../orchestration/workspace/toolContributions.ts";
import { accountsManifest } from "./contracts.ts";
import { AccountError } from "./service.ts";

/** Account schema validation belongs to the service; only its public errors may cross the link. */
export function accountsContribution(call: (args: unknown) => unknown): ToolContribution {
  return {
    manifest: accountsManifest,
    visible: ownerId => !!ownerId,
    requiresOwner: true,
    requiredRole: "workspace",
    unavailableError: "Accounts are unavailable.",
    formatError: error => error instanceof AccountError ? error.message : "Account operation could not be completed.",
    execute: p => call(p.args),
  };
}
