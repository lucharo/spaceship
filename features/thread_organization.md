# Thread organisation

The native Threads list can be organised chronologically or by working project, with visible recency, persistent pins, and independently collapsible sections. Spaceship preserves Codex app-server's canonical `projectId` and supplements it with Codex Desktop's native `thread-workspace-root-hints` metadata when the app-server has not assigned one; worktree sessions therefore remain with their originating project without copying thread history. These choices are local presentation state only and never alter the provider's native thread.
