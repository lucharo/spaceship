# Native sessions

Spaceship's main Threads list is the provider-native catalogue, not a second Spaceship history beside it. It lists metadata only, opens and continues the selected session through the provider's own interface using the same native ID, and keeps only rebuildable presentation state such as pins and collapsed groups; transcript bodies are read only after the user opens one session, while import or migration remains an explicit separate action.
