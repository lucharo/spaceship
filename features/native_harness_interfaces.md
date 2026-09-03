# Native harness interfaces

Spaceship is an interface over native agent harnesses, not another harness or canonical store. Each provider adapter should use the harness's native sessions, configuration, authentication, models, skills, and lifecycle operations wherever the provider exposes them; Spaceship may retain only explicit mappings and rebuildable UI state, and must not silently copy or rewrite provider-owned state.
