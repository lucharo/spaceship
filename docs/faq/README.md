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

**Short answer:** Active sessions appear in the main thread list, archived sessions are separated, and archiving delegates to Codex app-server from either the sidebar or `bb provider archive`.

Archiving a native row does not adopt it, create a Spaceship thread, or require a working directory. When a lightweight local projection already exists, Spaceship archives Codex once and then reconciles that projection without sending a duplicate provider command. Existing local projections can recover through native unarchive. A direct unarchive action in the archived catalogue, plus rename and fork parity, remains tracked rather than being emulated in Spaceship.

Before asking Codex to archive, Spaceship verifies that the matching local projection and every hidden source fork can be reconciled. Native adoption and archive are serialized by host, provider, and native session ID; local archive, unarchive, and every source-derived creation path are also serialized by projected source thread. A concurrent action therefore cannot adopt, reopen, or fork a session while its provider archive is in flight. BB-assigned child threads represent separate sessions, so they are released rather than archived with the parent. Once recorded, a durable confirmation prevents retries, later stop settlement, or process restart from sending the same provider archive command twice; crash recovery between provider success and that local write remains tracked separately. Unarchiving clears the confirmation.

### Sources

- [Native session architecture](../spaceship-native-sessions.md) — current lifecycle limits.
- `bb provider archive <providerId> <providerThreadId>` — CLI access to the same native operation.
- [Lifecycle parity issue](https://github.com/lucharo/spaceship/issues/4) — remaining direct unarchive, rename, and fork work.
- [Archive recovery issue](https://github.com/lucharo/spaceship/issues/16) — durable recovery for interruption between provider success and local reconciliation.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02_

## What does Spaceship keep locally for an opened native thread?

**Short answer:** A lightweight identity and control projection, never a second copy of the provider transcript.

Codex remains authoritative for messages, turns, errors, and continuation. Spaceship overlays local interface state such as goals, context usage, pending user requests, navigation, and unread state when it renders native history.

### Sources

- [Native session architecture](../spaceship-native-sessions.md) — authority and projection boundary.
- [Thread timeline route](../../apps/server/src/routes/threads/data.ts) — native history plus local control-state overlay.

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

**Short answer:** Yes for Codex. `$` searches installed skills only, while `/` keeps the broader command surface for every provider.

Insertion preserves the prefix the user typed, so selecting `wrapup` from a dollar-prefixed Codex search inserts `$wrapup`. Other providers keep slash syntax until they declare equivalent native support.

### Sources

- [Native skill invocation](../../features/native_skill_invocation.md) — product contract.
- [Prompt box](../../apps/app/src/components/promptbox/PromptBoxInternal.tsx) — command parsing and insertion.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02_

## What happens when Codex is unavailable?

**Short answer:** Spaceship immediately restores BB's ordinary thread list and stops retrying or polling the unavailable native catalogue.

Cached native metadata can support a fast initial paint, but a definitive provider error never leaves the sidebar trapped in an error loop.

### Sources

- [Native session cache](../../features/native_session_cache.md) — cache ownership and limits.
- [Native Codex sidebar](../../apps/app/src/components/sidebar/NativeCodexSidebar.tsx) — fallback presentation.
- [Native session query](../../apps/app/src/hooks/queries/native-session-queries.ts) — retry and polling behaviour.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02_

## Why does the default new-thread picker currently show only Codex?

**Short answer:** Spaceship shows only providers whose plugin declares native-session history support; today only Codex declares that capability.

The gate is provider-owned metadata rather than a Codex id check in core, so a future native adapter can opt in without another Spaceship-specific branch.

### Sources

- [Codex-first decision](../../features/codex_first.md) — current product boundary.
- [Provider registration projection](../../apps/server/src/services/providers/plugin-provider-registration.ts) — generic capability projection.
- [Root composer](../../apps/app/src/views/RootComposeView.tsx) — provider-neutral picker gate.

_Created: 2026-09-02 · Updated: 2026-09-02 · Verified: 2026-09-02_

## How are long native histories loaded?

**Short answer:** Spaceship returns bounded turn pages with older-page cursors, while Codex remains the source of the underlying history snapshot.

Codex app-server currently supplies `thread/read` as a complete snapshot. Provider-side incremental history reads and full-output hydration remain tracked in issue #12.

### Sources

- [Native history on demand](../../features/native_history_on_demand.md) — current paging boundary.
- [Thread timeline route](../../apps/server/src/routes/threads/data.ts) — native turn pagination.
- [History pagination issue](https://github.com/lucharo/spaceship/issues/12) — provider-side and output follow-up work.

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
