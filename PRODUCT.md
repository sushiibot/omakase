# omakase

Sushii is a private, self-hosted personal assistant for one owner.
The gateway serves an owner-only SvelteKit PWA on a private network (e.g. a tailnet).
The workspace runs agent sessions, delegated agents, memory, and scheduled work.

The owner uses the web app to chat, review work, manage tasks, inspect history and memory, and control approvals.
Main chat is the general conversation.
Topic conversations retain separate histories while sharing workspace memory.
Tasks are persistent assignments that the owner and assistant can both read and manage.
The owner can also keep ordinary to-dos without starting an agent.

Dots is a product reference for task conversations, visible progress, results, and follow-up prompts.
The task interface extends the existing app identity, tokens, typography, components, and light and dark themes.
On desktop, a right task panel stays beside chat.
On mobile, a swipe reveals the task panel and preserves the chat draft.
The interface must support keyboard navigation, touch targets, narrow viewports, and Android Back.

Sushii executes tasks with its delegated agents.
Connected machines can also run Codex and Claude Code sessions ([docs/machines.md](docs/machines.md)).
