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
