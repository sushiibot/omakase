import type { RunRecorder } from "./runLog.ts";
import type { TaskStore } from "./taskStore.ts";

/** Associate root runs with their task conversation after recording them. */
export function recordTaskRuns(
  recorded: RunRecorder,
  tasks: Pick<TaskStore, "setRunActivity" | "list" | "attachRun" | "settleRun">,
): RunRecorder {
  tasks.setRunActivity(id => recorded.getRun(id)?.status === "running");
  return {
    startRun(input) {
      const id = recorded.startRun(input);
      const task = !input.parentRunId && tasks.list().find(t => t.workConversationId === input.conversationId);
      if (task) tasks.attachRun(task.id, id, "Sushii");
      return id;
    },
    endRun(id, end) {
      recorded.endRun(id, end);
      tasks.settleRun(id, end.status, end.resultSummary);
    },
    listRuns: query => recorded.listRuns(query),
    getRun: id => recorded.getRun(id),
  };
}
