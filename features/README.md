# Spaceship features

This README is the index. Each design decision lives in its own short file;
implementation detail stays in code, architecture docs, and tracker issues.

| Feature                                                   | Status                                                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [Short name](short_name.md)                               | `sp`; `ss` is deliberately not used                                                                                        |
| [Native harness interfaces](native_harness_interfaces.md) | Codex sessions first; broader native state tracked in [#10](https://github.com/lucharo/spaceship/issues/10)                |
| [Native sessions](native_sessions.md)                     | Implemented for Codex through its provider plugin                                                                          |
| [Thread organisation](thread_organization.md)             | Implemented for active Codex threads                                                                                       |
| [Codex first](codex_first.md)                             | Implemented for new threads; more native adapters tracked in [#5](https://github.com/lucharo/spaceship/issues/5)           |
| [Native history on demand](native_history_on_demand.md)   | Implemented for Codex; pagination is tracked in [#12](https://github.com/lucharo/spaceship/issues/12)                      |
| [Native session cache](native_session_cache.md)           | Implemented for last-known Codex metadata                                                                                  |
| [Native session activity](native_session_activity.md)     | Implemented from Codex app-server status                                                                                   |
| [Native provider identity](native_provider_identity.md)   | Provider-owned thread icons tracked in [#15](https://github.com/lucharo/spaceship/issues/15)                               |
| [Native references](native_references.md)                 | Readable Codex citations implemented; rich source links remain follow-up work                                              |
| [Native turn presentation](native_turn_presentation.md)   | Native turn grouping implemented; thread-wide focus mode tracked in [#14](https://github.com/lucharo/spaceship/issues/14)  |
| [Plugin-first features](plugin_first_features.md)         | Implemented for the Codex thread list                                                                                      |
| [ACPX adapter](acpx_adapter.md)                           | Optional ACP transport candidate tracked through [#5](https://github.com/lucharo/spaceship/issues/5)                       |
| [Remote native hosts](remote_native_hosts.md)             | Tracked in [#3](https://github.com/lucharo/spaceship/issues/3)                                                             |
| [Skills management](skills_management.md)                 | Shared and provider skill roots are listed; native writes tracked in [#10](https://github.com/lucharo/spaceship/issues/10) |
| [Native skill invocation](native_skill_invocation.md)     | Installed skills support both `$name` and `/name` invocation                                                               |
| [Minimal by default](minimal_by_default.md)               | Primary navigation simplified                                                                                              |
