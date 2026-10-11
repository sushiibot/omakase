# Tasks

Tasks are saved assignments with a title, brief, status, checklist, and execution history.
The owner can create a task manually without starting an agent.
Sushii uses `task_manage` to read and change the same records.

## Interface

Open Tasks from the navigation menu to add, edit, complete, reopen, or cancel assignments.
The task detail has Overview, Conversation, and Runs sections.
Starting work opens a separate Sushii conversation for that task.
Follow-up prompts, questions, and approvals stay in that conversation.
Runs link to the existing activity viewer, which shows execution steps and results.

Main and topic conversations have a Tasks button in the header.
On desktop, the panel appears beside the chat.
On mobile, swipe left to reveal the panel or use the Tasks button.
Swipe right, press Back, or use Close tasks to return to chat.
The chat draft stays in place.
Each conversation panel shows tasks created there or assigned to that conversation.
The main Tasks page shows all tasks.

## State and execution

| Status      | Meaning                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| To do       | Saved work that has not started, or work available to resume             |
| In progress | An agent is working, or the assignment is marked in progress             |
| Needs you   | An agent needs an answer or approval, or a finished attempt needs review |
| Done        | The owner or assistant verified the assignment was complete              |
| Cancelled   | The assignment was abandoned                                             |

Creating a task does not execute it.
Completing an execution attempt does not automatically complete a task.
Stopping work stops its recorded runs and conversation turn, then returns the task to To do.
The checklist and conversation remain available.
Age does not remove a task.

## Storage and migration

The workspace stores canonical records in `state/tasks-v2.json` with atomic writes.
Updates require the current revision, which prevents an old form from replacing a newer edit.
The API returns an error on revision conflicts and the interface retains unsaved text.

On first startup, the store imports quick tasks and project checklists from the old task files.
It preserves the original index as `TASKS.md.before-tasks-v2` and leaves project files intact.
`TASKS.md` becomes a generated index for agent context.
The structured store remains the source of truth.
Legacy upkeep does not drop or archive these tasks.

The authenticated gateway exposes `GET /api/tasks` and `POST /api/tasks`.
Task conversations use `/api/tasks/:id/chat/*` and separate persisted topic sessions.
Internal task conversations stay out of the general conversation list.
Delegated agents attach their run IDs to task records and retain task identity when resumed.

## References and scope

The design follows [Dots](https://learn.chatgpt.com/docs/dots/tasks-and-memory): persistent assignments with conversation, progress, and results.
It also separates checklists from execution, as [Claude Code](https://code.claude.com/docs/en/interactive-mode#task-list) does.
[Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/frontend/todo-list) provides another reference for shared, visible task state.

The current execution backend is Sushii with its existing delegated agents.
Remote machine registration and Codex or Claude Code adapters require a separate implementation.
A standalone Codex app-server session does not guarantee visibility in the official Codex desktop or mobile interfaces.

## Verification

Store tests cover migration, revisions, restart persistence, execution state, and corrupt data.
Gateway tests cover manual creation, isolated task prompts, repeated starts, and stop behavior.
Browser tests cover manual tasks, checklists, drafts, sidebar navigation, accessibility, and small-screen layouts.
System tests exercise real gateway and workspace task creation, execution, follow-ups, and restart persistence.
