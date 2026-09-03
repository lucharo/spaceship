# Skills management

Spaceship has a dedicated Skills panel for browsing user, project, shared, and provider-native skills without making plugins the primary workflow. It lists every installed source by default, groups skills by their proven source repository and folder, and deduplicates symlinked views by canonical file path, so one skill such as `wrapup` appears once even when Codex and Claude expose the same shared installation. Provider-native roots and precedence remain authoritative; native writes remain tracked in [#10](https://github.com/lucharo/spaceship/issues/10).
