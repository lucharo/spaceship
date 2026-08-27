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
2. Spaceship shows title, working directory, timestamps, archive state, source,
   and the native thread ID. It does not read transcript bodies for discovery.
3. Opening a row creates or reuses a lightweight local projection keyed by the
   host, provider, and native thread ID.
4. Sending the next message dispatches `turn.submit`. If no local runtime is
   alive, the host daemon resumes the native Codex thread first.

## Authority rules

- Codex owns native history, lifecycle state, and continuation semantics.
- Spaceship owns presentation state such as local navigation, drafts, pins, and
  unread markers.
- Spaceship never writes Codex JSONL or SQLite files directly.
- Importing or copying history is a separate, explicit operation.
- A native session has one active writer. A second open reuses the same local
  projection instead of creating a divergent thread.

## Current limits

- Existing Codex transcript rendering is not yet available in Spaceship.
- The first native provider is Codex; additional provider adapters are future
  work.
- Named Codex profiles and remote-host catalogue UX are future work.
