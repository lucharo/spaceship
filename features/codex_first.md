# Codex first

Spaceship exposes only providers whose plugin declares native-session history support in the default new-thread flow; today that is Codex. Compatibility providers may remain available to BB internals and explicit extension surfaces, but they do not appear as if they offer the same native behaviour; broader adapter support is tracked in [#5](https://github.com/lucharo/spaceship/issues/5).
