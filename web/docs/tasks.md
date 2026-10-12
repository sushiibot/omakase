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
Done tasks are collapsed by default in both lists. Expand Done to view them,
then uncheck a task to return it to To do. Details and execution history stay available.

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
Conversation follow-ups and delegated runs preserve Done and Cancelled status.
Reopen the task explicitly to return it to active work.
Stopping work stops its recorded runs and conversation turn, then returns the task to To do.
The checklist and conversation remain available.
Age does not remove or archive a task.
Done and cancelled tasks remain saved; they leave the generated active index.
The old Markdown stale-review and upkeep code skips the generated index.

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
Records retain `sourceConversationId`, optional `workConversationId`, optional `parentTaskId`,
and up to 100 run IDs. The current store holds at most 2,000 tasks; it has no archive state.
The workspace already uses SQLite for other durable state, but this task store is a separate JSON file.

Activity lists execution attempts separately from saved tasks. Assignments is the default filter;
Scheduled, Replies, and All show the other views. Rows open execution details.
“Jump to conversation” goes to Main, the topic, or the task conversation and focuses the
originating turn when recorded. Older history is loaded in bounded batches; missing messages
show a recovery notice. Parent and delegated execution links live in Details.

Delegated agents attach their run IDs to task records and retain task identity when resumed.

## References and scope

The design follows [Dots](https://learn.chatgpt.com/docs/dots/tasks-and-memory): persistent assignments with conversation, progress, and results.
It also separates checklists from execution, as [Claude Code](https://code.claude.com/docs/en/interactive-mode#task-list) does.
[Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/frontend/todo-list) provides another reference for shared, visible task state.

Sushii can execute tasks with its existing delegated agents.
Configured machine daemons also support Codex and Claude Code sessions, with output, approvals, follow-ups, and stop controls.
The main agent can read and search explicitly shared file-server folders. See [connected-machine setup](../../docs/machines.md).
A standalone Codex app-server session does not guarantee visibility in the official Codex desktop or mobile interfaces.

## Verification

Store tests cover migration, revisions, restart persistence, execution state, and corrupt data.
Gateway tests cover manual creation, isolated task prompts, repeated starts, and stop behavior.
Browser tests cover manual tasks, checklists, drafts, sidebar navigation, accessibility, and small-screen layouts.
System tests exercise real gateway and workspace task creation, execution, follow-ups, and restart persistence.
