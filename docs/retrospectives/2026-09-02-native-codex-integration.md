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

The final convergence pass found three deeper native-boundary defects. Archive still adopted an unprojected session first, which could fail for sessions without a current working directory and created state merely to perform provider maintenance. Native history correctly owned the transcript but accidentally displaced local goals, context usage, and pending user requests. Finally, an item whose semantic phase became known only at completion could leave buffered output stranded at turn or process shutdown, and failed historical turns could lose their native error. The fixes make archive a direct provider RPC, reconcile only the matching native projection while releasing BB-assigned child sessions, persist provider confirmation so stop settlement or restart cannot duplicate the command, expose the same action through the CLI, overlay local control state without duplicating transcript rows, key pending items by native thread and turn identity, preserve interrupted status during timeout cleanup, and flush or clear deferred output at every terminal boundary.

The exact-head archive review found five final consistency hazards. A local unarchive could race the awaited provider archive, adoption could race the same native session through a different entry point, a general source-derived creation path could bypass the dedicated fork lock, hidden forks were validated only after their source had already changed state, and pruning a managed environment erased the host half of the native identity. Spaceship now places native lifecycle and source-derived operations behind one ordering boundary, then applies provider-identity and projected-thread locks; projected archive and unarchive use the daemon's ordered environment lane and update local state only after a connected provider accepts the operation. Bulk archive follows the same path, hidden forks are preflighted before provider mutation, native host identity survives workspace cleanup, and explicit native archive requests also start managed-workspace cleanup after local reconciliation. The durable confirmation remains compatible across the migration's earlier published hash: it suppresses automatic settlement and restart duplication, while explicit archive actions still contact the provider because the session may have been unarchived elsewhere. Durable recovery for a crash between provider success and that local write remains a follow-up. The associated tests also had to model native history faithfully: turn-scoped events require a turn start, and conversation rows inside a native turn must be inspected recursively rather than treated as top-level rows.

The landing review then tightened the failure paths. Migration rewind fixtures now remove the new native-host column before replay. Legacy projections whose environment disappeared before that migration are deliberately not auto-attached because no immutable host provenance remains; issue #18 tracks explicit recovery rather than risking a cross-host collision. Multi-thread archive writes each successful provider result back to its local projection before attempting the next session, so a later rejection cannot leave earlier provider state hidden behind active local rows. Cleanup is decided after the complete hidden-fork cascade, including idempotent re-archives. An ordinary archive of a projection with no remaining environment stays local, while a later unarchive uses the retained host identity and refuses to clear local archive state unless the provider accepts the operation. The deliberately conservative process-wide lifecycle lock remains safe but unnecessarily serial; issue #17 tracks replacing it with deterministic keyed locking rather than weakening the release fix.

The final native-history review found that the retained host identity was not yet used by timeline reads after environment pruning, and that the conversation outline still projected only local events. Native timeline and outline reads now share one provider-history projection: routing uses the retained native host, provider metadata supplies the workspace root when the environment is gone, and the complete outline reuses the same stable row IDs as paginated timeline pages. Both projections must retain full turn detail before the UI reduces it into collapsed summaries or outline items; asking the event projector for summary detail can legitimately omit an opening provider-owned user message and leave an outline target with no timeline row to mount.

The exact-head server suite caught one final privacy leak created by retaining that full detail: file-change display paths were workspace-relative, but the stable row ID still embedded the provider's original absolute path. File-change projection now removes the workspace prefix from both the visible path and its public identifier, preserving stable navigation without exposing local filesystem layout.

The full-branch review also caught the other half of environment pruning: reads still worked through the retained host identity, but reopening the sidebar row tried to validate an environment that no longer existed. Adoption now revalidates the provider's current workspace, reuses or recreates an unmanaged environment inside the existing project, and reattaches the same projection before navigation. Legacy projections without retained host identity remain excluded from this automatic recovery.

The last interaction review caught a subtler consequence of lazy native history. Opening a collapsed turn can start an asynchronous detail request, so counting render frames was not a reliable way to decide that an outline destination was unavailable. Outline jumps now observe the actual timeline subtree until the target mounts, inherit the target sequence through lazily fetched nested rows, cancel on thread or destination changes, and stop after a bounded wait. Each pane-issued target also carries an ownership-aware settlement callback, so a completed or failed jump releases forced expansion without allowing an older jump to clear a newer one. Replacement jumps clear the previous busy indicator immediately, and visit-scoped state prevents an A→B→A navigation from reviving it. The regressions were first demonstrated against the unfixed paths, then passed through the real pane, outline, lazy-detail, and row-rendering callers.

The final branch-wide review found two edges outside the native row itself. Archive-all took a stable child snapshot, but ordinary child creation, reparenting, and visibility changes did not share its lifecycle boundary; those mutations now serialize with archive preparation so they cannot make the cascade stale. Settings also refreshed release notes and opened links from BB upstream, which made a fork build describe a different product. Both the live source and full-changelog action now belong to the Spaceship repository.

It also exposed two existing macOS test assumptions: Linux process supervision expected `/proc`, and temporary paths could compare as `/tmp` versus `/private/tmp`. Those checks now use portable behaviour. The Electron window smoke itself cannot be torn down by this agent host because macOS denies signalling the spawned process; that test remains a runtime-environment exception rather than a product assertion.

## Lessons worth keeping

- Native-first is an authority boundary, not just a source label. Maintenance actions should reach the provider directly when no local projection is otherwise needed.
- Provider-owned history and local UI state can coexist, but the merge must be explicit and deterministic. Replacing either side wholesale loses information.
- Streaming translators need a distinct “seen but not yet classifiable” state. Empty buffered text is still state, and terminal events must flush or clear it.
- A wire change is incomplete until command registration, response unions, fixtures, dispatch, SDK exposure, and protocol version all move together.
- Any migration changed after a branch build may already exist in a real database. Make the SQL replay-safe and register the previous content hash before landing it.
- An awaited provider mutation creates a concurrency boundary. Preflight the complete local cascade first, then serialize conflicting local actions until reconciliation finishes.
- Native routing identity must outlive disposable workspace state, and every derived view of provider-owned history must use the same projection rather than quietly falling back to partial local data.
- Public row identity is part of the response surface. Any path-derived identifier must use the same workspace-relative normalisation as the visible payload.
- Human date groups are calendar boundaries, not elapsed 24-hour windows; local `setDate` arithmetic keeps yesterday and rolling-day buckets correct across DST transitions.
- Navigation into lazy provider history must wait for the destination itself, not an assumed number of renders. The destination sequence must propagate through every lazy subtree, and every wait needs ownership, cancellation, settlement, and a timeout.
- A lifecycle snapshot is valid only when every mutation that changes its membership shares the same ordering boundary, including ordinary child creation, reparenting, and visibility changes.
- Fork-owned release surfaces must read and link to the fork's own changelog; an upstream changelog is useful provenance, not the current product state.
- Exact provider and app tests caught semantic failures that typechecking could not; the live visual pass remained necessary for interaction and presentation confidence.

## What remains intentionally open

Provider-side incremental history reads and full-output hydration, direct archived-catalogue unarchive, native rename and fork, crash-safe archive recovery, additional provider adapters, remote hosts, richer source links, provider icons, native configuration writes, focus mode, public privacy automation, and reproducible packaged releases remain in GitHub issues. They were not folded into this integration merely to make the first release look broader.

Spaceship's short name is `sp`. `ss` is deliberately not used.

## Question audit

The session's durable Spaceship product questions now have concise, source-linked answers in the [Spaceship FAQ](../faq/README.md). Future provider adapters, remote hosts, and richer native interactions remain linked to tracker issues rather than being described as shipped. Comparative questions about unrelated external projects were left out because this repository cannot verify them as durable Spaceship facts.

---

Native Codex integration retrospective · Complete · Spaceship PR #9 · 2026-09-02 · `docs/retrospectives/2026-09-02-native-codex-integration.md`
