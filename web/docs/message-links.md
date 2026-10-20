# Message links

Every link to a message in a conversation (from saved items, runs, search, Home, push notifications,
or "Copy link") uses one shape:

```
<conversation path>?m=<message id>
```

- Conversation paths come from `conversationHref` (`src/lib/core/nav/conversation.ts`), mirrored on
  the gateway by `conversationUrl` (`src/surfaces/web/pushRules.ts`): `/chat` for main,
  `/chats/<id>` for a topic, `/tasks/<task id>?view=conversation` for a task's `task-t-<id>`.
- The message id is the event's stable key, which is the same live and after a reload:
  - an agent reply or proactive message: its outbox id (`web_events.key`; `ChatMessage.sourceId`;
    a live block's `messageKey`),
  - an owner message: its client id,
  - an ask: its ask id.
    An event with no key (imported history) uses `s<seq>`. `MESSAGE_REF_RE` validates either form.
- `?turn=<turnId>` is still accepted for older links and lands on that turn's reply.

## Landing

Opening a message link loads the history around the message (`GET …/chat/history?around=<id>`),
centres it without animation, moves focus to it, announces it politely, and tints it for about 2s
(a static outline until the next interaction under reduced motion). While the view is away from
the newest messages, a bar offers "Jump to latest". The jump is its own history entry, so Back
returns to where the link was opened. A message that no longer exists opens at the nearest
surviving one with an inline notice.
