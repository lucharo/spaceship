# Spaceship repository rules

- Spaceship is a control layer over native agent harnesses, not a replacement
  canonical history store.
- Keep each provider's native store authoritative. Never edit Codex rollout
  JSONL or SQLite directly; use Codex app-server operations.
- Discover with metadata only. Read transcript content only after the user
  explicitly opens that native session.
- Adopt native sessions idempotently by host, provider, and native session ID.
  One native session has one Spaceship writer.
- Import, migration, and copying are explicit user actions, never background
  sync behaviour.
- Product analytics, usage telemetry, and crash-report uploads stay disabled by
  default.
- This repository is public. Never commit real conversation text, internal
  company names, private hostnames, credentials, or user-specific filesystem
  paths. Tests use synthetic fixtures.
- BB remains the upstream application chassis. Keep upstream package names when
  changing them would create unrelated migration work.
- Spaceship's default navigation is skills-first and provider-native. Keep
  plugin, automation, mobile, and unavailable-provider surfaces out of the
  primary path unless the user explicitly opens their compatibility routes.
- Ship each user-facing feature as a standard BB plugin registration wherever
  possible. Add only generic host seams to BB core; keep provider-specific UI,
  policy, and behaviour in the owning plugin.
- Record each design decision in its own underscore-named
  `features/<decision_name>.md` file, keep `features/README.md` as the index,
  and link a tracker issue when implementation is incomplete.
