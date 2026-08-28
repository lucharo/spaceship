# Spaceship features

This folder is the small, durable product spec for Spaceship. Each feature gets
one short file stating the promise, the ownership rule, and the main non-goal;
implementation detail stays in code, architecture docs, and tracker issues.

| Feature                                                 | Status                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [Native harness interface](native-harness-interface.md) | Codex sessions first; broader native state tracked in [#10](https://github.com/lucharo/spaceship/issues/10) |
| [Native sessions](native-sessions.md)                   | Codex implementation in PR #9                                                                               |
| [Skills management](skills-management.md)               | Dedicated panel exists; native writes tracked in [#10](https://github.com/lucharo/spaceship/issues/10)      |
| [Minimal by default](minimal-by-default.md)             | Primary navigation simplified in PR #9                                                                      |
