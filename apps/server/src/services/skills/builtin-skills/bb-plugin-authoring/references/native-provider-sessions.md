# Native provider sessions

Use this reference when a provider plugin lists, opens, resumes, archives, or
projects sessions that already exist in the provider's own store. The provider
store remains authoritative; BB is an interface and runtime coordinator, not a
second transcript database.

## History projection

- Advertise `capabilities.experimental_supportsNativeSessionHistory` only when
  the bridge implements the matching native-session capabilities.
- Keep discovery metadata-only through `native/session/list`. Fetch exact
  metadata with `native/session/read`, and fetch turns only after the user opens
  a session through `native/session/history`.
- Project provider turns into BB timeline events in memory. Do not persist a
  copied transcript as BB-owned history.
- Map one provider turn to one BB turn. Preserve provider turn boundaries,
  timestamps, errors, interruptions, tool calls, and usage semantics.
- Compose projected history only with BB-owned head state that is not present in
  the native transcript, such as a pending interaction. Appending BB's complete
  stored event history duplicates accepted turns.
- Treat projected event and turn ids as read-only identities. Hide edit, fork,
  retry, or mutation actions unless the provider supports the corresponding
  native operation.

## Identity and concurrency

- Key adoption and coordination by `(hostId, providerId, providerThreadId)`.
  Titles, paths, and search results are presentation, not identity.
- Preserve the provider's real `cwd` for resume. Keep `projectId`,
  `workspaceRoot`, and `repositoryUrl` as separate grouping metadata; nullable
  values remain null.
- Canonicalise linked worktrees only for grouping. Never replace the runtime
  working directory with the canonical repository root.
- Adopt idempotently. Reopening one native identity must find the existing BB
  projection instead of creating a sibling.
- Enforce one writer per native identity. Serialize resume, send, archive,
  rename, and delete-like operations around that immutable key.
- After asynchronous provider work, revalidate the host, provider, native
  identity, archive state, and source relationship before committing local
  projection state.
- Apply provider mutation first, then update BB's projection atomically. Never
  guess missing host or provider identity from a title, path, or current client.

## Protocol propagation

For a new capability, method, field, or changed meaning, follow the contract all
the way through:

1. Provider Bridge Protocol schema, request vocabulary, grammar snapshot, and
   version history.
2. `initialize` capabilities and every bridge implementation or compatibility
   fixture.
3. Host daemon/runtime routing, server route, success/error unions, and SDK.
4. Plugin API map, bundled declarations, CLI/docs, fake runtimes, and tests.

Bump the provider protocol when an older runtime or bridge cannot tolerate the
change. Keep explicit fixtures for supported older versions. Additive optional
methods remain capability-gated: the runtime must not probe a bridge that did
not advertise them.

## Event finalisation

- Preserve zero-delta turn starts; they can still terminate with useful state.
- Buffer partial text or tool output only with an explicit owner and lifecycle.
- Flush buffered output before completed, failed, or interrupted boundaries,
  then clear all per-turn state.
- A user stop finalises buffered work as interrupted, not failed.
- Historical projection and live streaming must produce equivalent terminal
  status, error, turn-boundary, and usage semantics.
- Test the raw bridge deltas and the real runtime caller. A helper-only test can
  pass while the helper is no longer wired into the provider path.

## Caching

- Cache native-session metadata only. Never cache transcript bodies.
- Partition active and archived queries, and include host, provider, search,
  workspace, pagination, and capability generation in the cache identity where
  they change the result.
- Match cached rows by exact native identity. Do not enable lifecycle actions
  until live host/provider identity has resolved.
- Keep one cache/query owner and invalidate through it after provider changes.
  Do not let a sidebar, route, and plugin each invent their own stale copy.
- Traverse every provider page needed for the requested view. Avoid per-row
  follow-up reads during listing.
- Do not use second-resolution timestamps as the only freshness signal.
- Stop automatic retries on definitive auth, incompatibility, and
  not-installed errors; transient transport failures may retry with bounds.

## Runtime verification

- Run repository checks with the pinned Node version and package manager, using
  Turbo for builds and typechecks.
- Verify both source-checkout and packaged-plugin loading. Exact SDK subpath
  aliases matter; prefix matching can resolve the wrong module.
- Rebuild or reload every owned server, daemon, bridge, and app process after a
  protocol change before diagnosing UI behavior.
- Run provider bridge conformance plus a recorded or bounded real-provider
  canary. Confirm list, read, open/resume, one new turn, archive/unarchive when
  supported, and reopen after restart.
- Verify the user-visible result after a cold reload: no duplicate projection,
  stable grouping, correct active/archive split, cached metadata immediately,
  and transcript content fetched only after open.
- Distinguish environment failures such as Node ABI, TLS trust, missing
  executable, and stale daemon protocol from product regressions.

## Definition of done

The native store is still authoritative; identity is stable and single-writer;
history is lazy and non-duplicating; protocol surfaces agree; every turn has one
terminal outcome; caches contain metadata only; and a cold real-runtime test
proves discovery through native continuation.
