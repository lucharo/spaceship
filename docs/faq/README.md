# Spaceship FAQ

## Where does Spaceship get Codex sessions?

**Short answer:** From Codex app-server, using its native thread catalogue rather than parsing or replacing Codex's store.

Spaceship asks for session metadata first. It reads a transcript only after the user opens that session.

### Sources

- [Native session architecture](../spaceship-native-sessions.md) — authority, privacy, and open/resume flow.
- [Codex provider bridge](../../plugins/provider-codex/src/bridge/bridge.ts) — app-server requests and native session operations.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02_

## Does Spaceship copy or synchronise native histories?

**Short answer:** No. The provider's native store remains authoritative; Spaceship keeps only the local projection and presentation state needed to open it.

Copying or migration must be a separate, explicit action. Silent two-way sync would create competing histories and lose provider-private state.

### Sources

- [Native harness interfaces](../../features/native_harness_interfaces.md) — provider ownership rule.
- [Native history on demand](../../features/native_history_on_demand.md) — read-through presentation model.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02_

## Why doesn't an ACP-connected client automatically show existing Codex sessions?

**Short answer:** A runtime connection and a native-session catalogue are separate capabilities.

The adapter must expose discovery and resume operations, and the client must use them. A client can start Codex or resume a known ID while still listing only records from its own database.

### Sources

- [Provider bridge protocol](../provider-bridge-protocol.md) — capability negotiation and provider lifecycle.
- [Capability-based native session adapters](https://github.com/lucharo/spaceship/issues/5) — follow-up coverage for other providers and ACP-backed adapters.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02 · Scope/version: Spaceship's current provider bridge_

## What happens when I open a native Codex session?

**Short answer:** Spaceship revalidates the native metadata, reuses or creates one local projection, reads history from Codex, and resumes the same native thread for the next message.

The projection is keyed by host, provider, and native session ID, so reopening the row does not create a second writer.

### Sources

- [Native session architecture](../spaceship-native-sessions.md) — end-to-end sequence.
- [Native session server service](../../apps/server/src/services/system/native-sessions.ts) — validation and provider dispatch.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02_

## Why can a Codex session started by another tool appear in Spaceship?

**Short answer:** If that tool launches native Codex against the same `CODEX_HOME`, both clients see the same provider-owned session store.

This is shared native state, not a cloud sync or transcript import. A tool using a different Codex profile or home will expose a different catalogue.

### Sources

- [Named Codex profiles issue](https://github.com/lucharo/spaceship/issues/2) — multiple native stores remain explicit future work.
- [Native session architecture](../spaceship-native-sessions.md) — native ownership model.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02 · Scope/version: conditional on a shared CODEX_HOME_

## How are active and archived Codex sessions handled?

**Short answer:** Active sessions appear in the main thread list; archived sessions are separated, and archive or unarchive operations are delegated to Codex app-server.

Rename and fork parity remain tracked separately rather than being emulated in Spaceship.

### Sources

- [Native session architecture](../spaceship-native-sessions.md) — current lifecycle limits.
- [Lifecycle parity issue](https://github.com/lucharo/spaceship/issues/4) — remaining rename and fork work.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02_

## How are Codex worktrees grouped with their original project?

**Short answer:** Spaceship prefers Codex's native project identity and workspace-root metadata, then groups worktree sessions under that canonical project.

The visible working directory is still retained on each row, but it is not treated as a separate project merely because Codex created a worktree path.

### Sources

- [Native session metadata](../../plugins/provider-codex/src/native-session-metadata.ts) — project and workspace identity derivation.
- [Native Codex sidebar](../../apps/app/src/components/sidebar/NativeCodexSidebar.tsx) — project grouping and row presentation.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02_

## Where do installed skills come from?

**Short answer:** Spaceship discovers the host's shared and provider-native skill roots, preserves source provenance, and deduplicates symlinked copies by canonical file path.

The Skills view is an interface over those installations. Provider-native write operations are still tracked rather than being replaced with another Spaceship-owned skill store.

### Sources

- [Skills management](../../features/skills_management.md) — ownership and grouping decision.
- [Skill listing service](../../apps/server/src/services/skills/skill-listing.ts) — discovery, provenance, and deduplication.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02_

## Can I invoke a skill with `$name` as well as `/name`?

**Short answer:** Yes. `$` searches installed skills only, while `/` keeps the broader command surface.

Insertion preserves the prefix the user typed, so selecting `wrapup` from a dollar-prefixed search inserts `$wrapup`.

### Sources

- [Native skill invocation](../../features/native_skill_invocation.md) — product contract.
- [Prompt box](../../apps/app/src/components/promptbox/PromptBoxInternal.tsx) — command parsing and insertion.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02_

## Why is native Codex history more compact than raw provider events?

**Short answer:** Spaceship projects provider events onto native turn boundaries, hides successful hook noise, and keeps final conversation messages readable.

The current projection is intentionally lighter than a raw event log. A thread-wide focus mode and richer expandable detail remain tracked work.

### Sources

- [Native turn presentation](../../features/native_turn_presentation.md) — intended presentation.
- [Codex delta translation](../../plugins/provider-codex/src/delta-translation.ts) — event projection rules.
- [Focus mode issue](https://github.com/lucharo/spaceship/issues/14) — remaining interaction.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02_

## What is Spaceship's short name?

**Short answer:** `sp`.

`ss` is deliberately not used. The short name is a project naming decision, not yet a promise of an installed executable alias.

### Sources

- [Short name decision](../../features/short_name.md) — canonical naming decision.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02_
