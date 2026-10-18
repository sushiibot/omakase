export const taskManifest = {
  name: "task_manage",
  description:
    "Manage the owner's persistent tasks and checklists. Actions: list, get, create, update, prepare, start, stop. create saves a to-do without executing it. prepare opens the task's work conversation without starting a run. start opens the task's own conversation and starts work there; it can delegate coding or research, including to coding agents on the owner's machines with coding_agent. update requires the latest revision from get/list. Use patch.checklist items {id,title,done}. Mark done only when the outcome is verified. Never treat a stopped run as a cancelled task. Tasks and their runs are separate; use run IDs for delegate continue.",
  approval: "none" as const,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["list", "get", "create", "update", "prepare", "start", "stop"],
      },
      id: { type: "string" },
      title: { type: "string" },
      brief: { type: "string" },
      text: { type: "string" },
      conversationId: { type: "string" },
      parentTaskId: { type: "string" },
      revision: { type: "integer" },
      patch: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          brief: { type: "string" },
          status: {
            type: "string",
            enum: ["todo", "in-progress", "needs-you", "done", "cancelled"],
          },
          checklist: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "title", "done"],
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                done: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
};
