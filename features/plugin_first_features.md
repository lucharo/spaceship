# Plugin-first features

Each user-facing Spaceship feature should be a standard BB plugin registration wherever possible. BB core supplies small provider-neutral seams; the owning plugin supplies provider-specific navigation, UI, policy, and behaviour so features stay removable, composable, and independently testable.
