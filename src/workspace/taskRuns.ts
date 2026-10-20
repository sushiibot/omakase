import type { RunRecorder } from "./runLog.ts";
import type { TaskStore } from "./taskStore.ts";

/**
 * Associate root runs with their task conversation after recording them. A run without a conversation (a scheduled
 * job) belongs to no task: matching its missing ID against a task without one attached every job run to that task.
 */
export function recordTaskRuns(
  recorded: RunRecorder,
  tasks: Pick<TaskStore, "setRunActivity" | "list" | "attachRun" | "settleRun" | "detachRuns">,
): RunRecorder {
  tasks.setRunActivity(id => recorded.getRun(id)?.status === "running");
  // Repair links made by the old matching: a root run with no conversation can't belong to any task.
  tasks.detachRuns(id => {
    const run = recorded.getRun(id);
    return !!run && !run.parentRunId && !run.conversationId;
  }, id => recorded.getRun(id) ?? undefined);
  return {
    startRun(input) {
      const id = recorded.startRun(input);
      const task = !input.parentRunId && input.conversationId && tasks.list().find(t => t.workConversationId === input.conversationId);
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
