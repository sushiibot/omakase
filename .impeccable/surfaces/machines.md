# Connected machines surface handoff

This is an ordinary extension of the existing Sushii task interface. The direction is Operate: choose a connected machine, coding folder and provider; start a task; inspect output; answer approvals; follow up or stop work. The main agent also gains read-only text access to shared file-server folders. Visual authority remains `PRODUCT.md`, `web/docs/ux-guidelines.md`, `web/src/app.css` and the shared Button component. No new visual world or composition was selected.

## Finished surface

`remote-task.svelte` is shared by task details and the chat task inspector. Saving a to-do stays separate from starting execution. A dirty title or brief is saved before starting remote work. The target picker includes connected machines, coding-enabled folders and configured Codex or Claude Code providers.

Discovery distinguishes loading, request failure with retry, no configured machines with a setup link, and configured machines with no available coding target. A remote session shows provider, machine, folder, status, attempt and bounded text output. Follow-ups resume the session. Finishing an attempt does not automatically complete the task.

Approval descriptions preserve the command and working folder. The approval group sits toward the bottom of the available session view, with Approve and outline Deny actions separated by an 8px gap. The removed side stripe adds no replacement decoration. Stop remains a separate outline action.

## Incumbent system comparison

- Palette and depth: existing background, foreground, primary, muted, border and failed roles supply the surface. Output uses a muted fill and thin border; approvals use a top divider. No new colors or shadows were introduced.
- Typography: Inter Variable and the incumbent hierarchy remain. Section headings and session explanations use small text; editable text and target selection use the base 1rem size. Output uses the existing monospace treatment and wraps long text.
- Controls: shared Button primary and outline variants supply approval, retry, setup, follow-up and stop actions. Default buttons and the native select retain 48px height. Shared focus, disabled and theme behavior remain authoritative.
- Layout: the existing task detail and inspector containers own navigation and outer gutters. Remote content uses a vertical stack with 8px and 12px gaps; narrow content wraps without introducing a separate sidebar.
- Rules: preserve task identity, keep starting work explicit, expose required actions and failures, and keep command context beside the approval. These apply existing UX guidance to this surface rather than introducing global rules.

## Evidence checked

Source comparison covered `web/src/app.css`, `web/src/lib/ui/button/button.svelte`, `web/src/lib/features/tasks/remote-task.svelte`, `task-detail.svelte` and `task-inspector.svelte`. Product and operating context came from `PRODUCT.md`, `web/docs/ux-guidelines.md`, the existing tasks surface handoff and `docs/machines.md`.

The final captures were opened for this documentation pass: `.impeccable/review/machines-mobile.png` at 320×915 CSS pixels (device scale 2.625), `machines-desktop.png` at 1280×915 CSS pixels, and `machines-discovery-error.png` at 412×915 CSS pixels. They show the retained approval command and folder, bottom approval actions, removed stripe and visible discovery retry. They establish light-theme browser rendering for these states. Dark-theme behavior is supported by source token reuse; these captures do not establish a dark-theme visual review or real Android PWA verification.

The supplied `/tmp/sushii-machines-detector.json` contains no findings from the one detector run on the new component. The finish reviewer returned a scoped ship verdict after resolving the three named fixes: mobile approval placement with context, stripe removal, and discovery state distinctions. No detector or tests were rerun during documentation.

The implementation handoff reports three targeted browser tests and eleven task checks passing, plus backend tests (2,630 passed), system flows (27 passed, one inherited skip), typecheck, web check and lint. Codex and Claude transport was exercised through the real outbound daemon connection with fake CLI providers. This does not establish live model inference or a configured owner machine.

## Drift and limitations retained

`PRODUCT.md` still describes remote machines and external coding harnesses as planned extensions. The shared Button API still exposes small and icon variants below the documented 48px minimum; this surface uses default controls. No `DESIGN.md` or design sidecar exists. These incumbent documentation/API discrepancies are reported without repair because this ordinary extension authorizes only this surface handoff.

`docs/machines.md` remains the setup and limitations reference. CLI authentication stays on each machine; shared-file access is read-only and limited to text. Claude Code retains its normal CLI permissions, and selecting a coding root is not an operating-system sandbox. Unsupported Codex interactive requests block instead of receiving automatic approval. Session visibility in the official Codex or Claude applications is not guaranteed. File-server access has no separate browser management screen in this change.
