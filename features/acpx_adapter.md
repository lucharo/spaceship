# ACPX adapter

ACPX is a useful optional transport/runtime candidate for providers whose best supported interface is ACP, especially where it can expose a provider-native session ID. It does not replace Spaceship's direct Codex app-server adapter: ACPX also maintains its own session records, while Spaceship's native-first rule keeps the provider store authoritative. Capability-based ACP/ACPX adapters remain tracked in [#5](https://github.com/lucharo/spaceship/issues/5).
