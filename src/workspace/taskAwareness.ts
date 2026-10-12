import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { TaskStore } from "./taskStore.ts";
export function taskAwareness(
  tasks: TaskStore,
  conversationId: string,
): ExtensionFactory {
  return (pi) => {
    let context = "";
    pi.on("before_agent_start", () => {
      const current = tasks
        .list()
        .find((t) => t.workConversationId === conversationId);
      const index = tasks
        .list()
        .filter((t) => t.status !== "done" && t.status !== "cancelled")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 40)
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          agent: t.agent,
          execution: t.execution,
        }));
      context = `Tasks are persistent shared assignments. Use task_manage to list, create, update, start or stop tasks. Use the returned revision for updates. TASKS.md is a generated index, not an editable store. A finished run is not proof of task completion: mark done only after the objective and verification are satisfied. Keep checklists current. Do not start every saved to-do automatically.\nOpen tasks: ${JSON.stringify(index)}${current ? `\nThis conversation works on task ${current.id}: ${JSON.stringify(current)}. Follow-ups continue this task. Return concise results and update its checklist and status.` : ""}`;
    });
    pi.on("context_with_system", ({ messages }) => {
      if (!context || messages[0]?.role !== "system") return;
      const [system, ...rest] = messages;
      return {
        messages: [
          { ...system, sections: { ...system.sections, tasks: context } },
          ...rest,
        ],
      };
    });
  };
}
