# Native history on demand

Opening a native thread renders its existing provider-owned history on demand without importing it into a Spaceship store. Discovery remains metadata-only, only the chosen thread is read, and Codex app-server remains authoritative for both history and continuation. Spaceship overlays only local control state needed by the interface, including goals, context usage, and pending user requests. It serves bounded turn pages; provider-side incremental reads and full-output hydration are tracked in [#12](https://github.com/lucharo/spaceship/issues/12).
