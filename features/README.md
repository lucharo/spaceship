# Spaceship features

This README is the index. Each design decision lives in its own short file;
implementation detail stays in code, architecture docs, and tracker issues.

| Feature                                                   | Status                                                                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [Native harness interfaces](native_harness_interfaces.md) | Codex sessions first; broader native state tracked in [#10](https://github.com/lucharo/spaceship/issues/10)      |
| [Native sessions](native_sessions.md)                     | Implemented for Codex through its provider plugin                                                               |
| [Thread organisation](thread_organization.md)             | Implemented for active Codex threads                                                                             |
| [Codex first](codex_first.md)                             | Implemented for new threads; more native adapters tracked in [#5](https://github.com/lucharo/spaceship/issues/5) |
| [Native history on demand](native_history_on_demand.md)   | Implemented for Codex; pagination is tracked in [#12](https://github.com/lucharo/spaceship/issues/12)           |
| [Native session cache](native_session_cache.md)           | Implemented for last-known Codex metadata                                                                        |
| [Plugin-first features](plugin_first_features.md)         | Implemented for the Codex thread list                                                                            |
| [Remote native hosts](remote_native_hosts.md)             | Tracked in [#3](https://github.com/lucharo/spaceship/issues/3)                                                   |
| [Skills management](skills_management.md)                 | Dedicated panel exists; native writes tracked in [#10](https://github.com/lucharo/spaceship/issues/10)           |
| [Minimal by default](minimal_by_default.md)               | Primary navigation simplified                                                                                    |
