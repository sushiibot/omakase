# Tasks surface handoff

This is an ordinary extension of the existing Sushii web interface. The direction is Operate: save and manage assignments, keep manual to-dos separate from agent execution, and make task conversations and runs available beside chat. Visual authority remains `web/src/app.css`, shared UI components, and `web/docs/ux-guidelines.md`. This handoff introduces no visual world or duplicate token system.

## Finished surface

The main Tasks page lists all tasks. Conversation panels filter by source or work conversation. Status sections show sentence case headings and counts. Rows show titles, agent identity, and checklist progress. Native checkboxes provide completion controls separately from opening details.

Details offer Overview, Conversation, and Runs. Creating manual tasks or changing checklists does not start execution. Starting or continuing work first saves a dirty title or brief; a failed save aborts the start. Successful starts reveal the task conversation. Runs link to the existing activity viewer. These behaviors follow `PRODUCT.md` and `web/docs/tasks.md`.

The final implementation handoff confirms that task chat connects the existing photo attachment callbacks and store, and form action errors persist across background polling until retry or edit. Navigation guidance now names Tasks for persistent assignments and Activity for execution history. These behavior changes preserve the incumbent visual system.

## Incumbent system comparison

- Palette: task components use existing background, foreground, primary, muted, border, ring, and failed roles. Light and dark values remain owned by `web/src/app.css`. Borders and muted hover fills provide separation without new shadows.
- Typography: Inter Variable and the existing hierarchy remain. Headings use base text and semibold weight; rows use UI text, explanations use small text, and metadata uses meta text. Corrected task inputs and the brief textarea use the base size (1rem), matching the minimum input-size guidance.
- Controls: primary, outline, and ghost actions reuse `Button`. Default actions and explicit icon controls use 48px targets. `ChecklistCheckbox` places a small visible box inside a 48px native input target, with existing focus and disabled treatments.
- Layout: content retains the 16px gutter and spacing rhythm. At 1100px and above, the open right panel is 24rem wide beside chat. Below that breakpoint, the full-width panel slides into view; chat stays mounted and becomes inert. Visible Tasks and Close tasks controls provide gesture alternatives.
- Motion and focus: the mobile panel follows the finger and settles with a short transition. Reduced motion disables the transform transition. Interactive controls and screen edges are excluded from swipe starts. Reveal focuses the panel; closing restores focus to the Tasks trigger. Routes use the existing routed sheet mechanism.

## Evidence checked

Source comparison covered `web/src/app.css`, `web/src/lib/ui/button/button.svelte`, `web/src/lib/ui/input/input.svelte`, `web/src/lib/features/chat/components/composer.svelte`, `web/src/lib/ui/checklist-checkbox.svelte`, `web/src/lib/ui/workspace/split-workspace.svelte`, task list/detail/panel/workspace components, and Tasks/Main/topic route integrations. Product and lifecycle sources were `PRODUCT.md`, `web/docs/tasks.md`, and `web/docs/ux-guidelines.md`. Corrected task list/detail input classes were rechecked after the size edit.

The final `.impeccable/review/desktop.png`, `mobile.png`, and `mobile-detail.png` were recaptured after the input-size correction and opened for this handoff. Desktop shows the fully open Tasks panel beside light-theme chat, with Tasks and Activity navigation. Mobile shows the fully open list at full viewport width. Mobile detail shows the corrected title and brief fields, checklist, result, and execution controls. Dark-theme preservation is supported by source token reuse; these captures do not establish a dark-theme visual review or real-device gesture verification.

The supplied `/tmp/sushii-tasks-detector.json` contains no findings. No browser or detector was rerun during documentation. The finish reviewer reported `ship` after scoring the dirty-brief save fix resolved; that verdict pass covered the named fix.

## Drift and limitations retained

The shared Button API exposes small and icon variants below the documented 48px minimum. Tasks uses default or explicit 48px controls. This handoff neither repairs the incumbent API nor promotes smaller variants into a design rule.

No `DESIGN.md` or design sidecar exists in the supplied system. This ordinary extension does not authorize creating a replacement system record.
