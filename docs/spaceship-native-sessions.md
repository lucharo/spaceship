# Native session architecture

Spaceship is a thin desktop control layer over native coding-agent harnesses.
It gives users one interface without replacing each provider's authoritative
session store.

## Current Codex flow

```text
Codex native store
       |
       | thread/list (metadata only)
       v
Codex app-server <-> Spaceship provider bridge <-> Spaceship UI
       ^                                               |
       | thread/resume                                 | adopt selected ID
       +-----------------------------------------------+
```

1. The Codex provider bridge asks app-server for native session metadata.
2. Spaceship uses that metadata as its main Threads list. Active sessions are
   searchable, pageable, groupable by recency or project, pinnable, and
   collapsible. It does not read transcript bodies for discovery.
3. Opening a row re-reads metadata from Codex, confirms the session is active,
   then creates or reuses a lightweight local projection keyed by the host,
   provider, and native thread ID.
4. Spaceship reads the selected thread's native history on demand and projects
   Codex turns into the timeline without copying them into BB event storage.
5. Sending the next message dispatches `turn.submit`. If no local runtime is
   alive, the host daemon resumes the native Codex thread first.

## Authority rules

- Codex owns native history, lifecycle state, and continuation semantics.
- Spaceship owns presentation state such as local navigation, drafts, pins,
  collapsed groups, and unread markers.
- Spaceship never writes Codex JSONL or SQLite files directly.
- Raw app-server discovery responses are excluded from provider-wire
  diagnostics because they can contain transcript previews and rollout paths.
- Importing or copying history is a separate, explicit operation.
- A native session has one active writer. A second open reuses the same local
  projection instead of creating a divergent thread.

## Current limits

- The current native-history projection opens the latest complete history;
  bounded older-page loading and full-output hydration are tracked in
  [#12](https://github.com/lucharo/spaceship/issues/12).
- Archive and unarchive delegate to Codex app-server. Native rename and fork
  parity remain tracked in [#4](https://github.com/lucharo/spaceship/issues/4).
- The default new-thread path is Codex-only until another provider has an
  equivalent native adapter; see
  [#5](https://github.com/lucharo/spaceship/issues/5).
- Named Codex profiles and remote-host catalogue UX are tracked in
  [#2](https://github.com/lucharo/spaceship/issues/2) and
  [#3](https://github.com/lucharo/spaceship/issues/3).
