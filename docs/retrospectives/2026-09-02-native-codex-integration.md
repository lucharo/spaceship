# Native Codex integration retrospective

Spaceship now treats Codex as the owner of its sessions while supplying the desktop interface around them. The work began as session recovery and became a clearer product rule: prefer native harness interfaces for sessions, configuration, authentication, and skills; keep Spaceship's own state limited to presentation and coordination.

## What shipped

- Native Codex sessions appear in the primary Threads sidebar, with metadata-first discovery, search, project or recency grouping, pins, activity state, and archive actions.
- Opening a row reads native history on demand and resumes the same Codex thread. Spaceship does not copy that history into its event store.
- Worktree sessions group under their canonical project identity rather than appearing as unrelated projects.
- Codex event projection respects native turn boundaries, hides successful hook noise, retains failures, and normalises citation markers.
- Installed skills are discovered from shared and provider roots, grouped by provenance, and deduplicated by canonical path. Codex supports `$name` and `/name`; other providers retain `/name`.
- Provider-specific behaviour remains in plugins. Core changes are limited to generic contracts, lifecycle hooks, caching, and sidebar seams.

## Decisions that changed the direction

AgentsView remains an observation layer; it is not Spaceship's session engine. DeepSeek Harness remains useful for explicit import and migration, but copied histories are not native continuation. BB is the application chassis because its provider bridge and plugin surface already provide most of the needed structure.

The main architectural distinction is simple: transport access is not catalogue ownership. ACP can connect a client to an agent, but an old-session browser still needs explicit list, read, and resume capabilities plus UI that chooses to expose them. Codex app-server already owns those semantics for Codex, so Spaceship uses it directly through the provider plugin.

## What the verification pass caught

The final sweep found several contract edges that narrower tests had missed: every host-daemon wire change needs a protocol bump; the packaged smoke test must use the same provider protocol version; protocol grammar defaults must follow the peer's declared protocol; buffered Codex text must survive when an item's phase is known only at completion; and public SDK changes require regenerating the API inventory.

The isolated runtime found two more faults that unit-only checks would not have exposed. Plugin SDK bare aliases were swallowing explicit subpath imports at runtime, so the resolver now registers current and legacy subpaths before the package root. A completed Codex turn could also remain visually "running" until reload; completion events now invalidate the thread detail query, and a no-reload continuation confirmed that the composer returns to idle.

The landing review caught the remaining boundary failures: native history needed identity verification and turn pagination, including an active final turn; catalogue projection needed one batched native-identity lookup rather than one database query per row; unavailable providers needed to stop retrying and yield the sidebar; directly symlinked skill files needed a single-file read boundary; provisional picker values could not be sent before their catalogues were verified; and `$skill` completion had to remain Codex-specific until other providers declare equivalent support.

The exact-head review then caught two small but important violations of that same rule. Removing the last Codex id check had accidentally exposed compatibility providers in the default new-thread picker, so native-session eligibility is now provider-declared metadata projected through the generic provider contract. It also found that a `$` query with only slash-command matches could open an empty menu; the composer now suppresses the menu from the provider-filtered result, with a mutation-proven regression test.

The final convergence pass found three deeper native-boundary defects. Archive still adopted an unprojected session first, which could fail for sessions without a current working directory and created state merely to perform provider maintenance. Native history correctly owned the transcript but accidentally displaced local goals, context usage, and pending user requests. Finally, an item whose semantic phase became known only at completion could leave buffered output stranded at turn or process shutdown, and failed historical turns could lose their native error. The fixes make archive a direct provider RPC, preflight the complete local cascade before changing the provider store, reconcile existing projections without a duplicate provider command even after an active stop settles, expose the same action through the CLI, overlay local control state without duplicating transcript rows, key pending items by native thread and turn identity, preserve interrupted status during timeout cleanup, and flush or clear deferred output at every terminal boundary.

It also exposed two existing macOS test assumptions: Linux process supervision expected `/proc`, and temporary paths could compare as `/tmp` versus `/private/tmp`. Those checks now use portable behaviour. The Electron window smoke itself cannot be torn down by this agent host because macOS denies signalling the spawned process; that test remains a runtime-environment exception rather than a product assertion.

## Lessons worth keeping

- Native-first is an authority boundary, not just a source label. Maintenance actions should reach the provider directly when no local projection is otherwise needed.
- Provider-owned history and local UI state can coexist, but the merge must be explicit and deterministic. Replacing either side wholesale loses information.
- Streaming translators need a distinct “seen but not yet classifiable” state. Empty buffered text is still state, and terminal events must flush or clear it.
- A wire change is incomplete until command registration, response unions, fixtures, dispatch, SDK exposure, and protocol version all move together.
- Exact provider and app tests caught semantic failures that typechecking could not; the live visual pass remained necessary for interaction and presentation confidence.

## What remains intentionally open

Provider-side incremental history reads and full-output hydration, direct archived-catalogue unarchive, native rename and fork, additional provider adapters, remote hosts, richer source links, provider icons, native configuration writes, focus mode, public privacy automation, and reproducible packaged releases remain in GitHub issues. They were not folded into this integration merely to make the first release look broader.

Spaceship's short name is `sp`. `ss` is deliberately not used.

## Question audit

The session contained 18 durable Spaceship product questions. Fifteen now have concise, source-linked answers in the [Spaceship FAQ](../faq/README.md); three are represented by current feature specifications or tracker issues because their answer is intentionally incomplete. Two additional comparative questions about unrelated external projects were left out because this repository cannot verify them as durable Spaceship facts.

---

Native Codex integration retrospective · Complete · Spaceship PR #9 · 2026-09-02 · `docs/retrospectives/2026-09-02-native-codex-integration.md`
