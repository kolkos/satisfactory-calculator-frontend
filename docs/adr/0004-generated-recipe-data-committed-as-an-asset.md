# Recipe data is generated locally, committed to git, and served as a static asset

`Docs.json` ships inside a Satisfactory installation (`CommunityResources/Docs/Docs.json`). It is game content, and it does not exist on a CI runner. Parsing it during the build would therefore break every environment without the game installed. Instead, an npm script runs `satisfactory-docs-parser` locally against a developer's own copy, writes a trimmed and version-stamped JSON into `public/`, and that output is committed.

## Considered Options

- **Parse during the build.** Always in sync with the installed game and nothing derived in git, but it makes a Satisfactory installation a build dependency — no CI, and no contributions from anyone who does not own the game.
- **Import the JSON into the bundle.** Type-safe with no runtime validation or loading state, but a bundler inlines the import into the JS chunk, where it counts against the 1MB initial-bundle error budget in `angular.json`.
- **Fetch from a community API or CDN at runtime.** Always current without regeneration, but it introduces a network dependency and a third party into an app that is deliberately entirely clientside.

## Consequences

Generated data lives in version control, which normally deserves suspicion. The reason it is correct here is recorded above; regenerating is a deliberate, reviewable act tied to a game version rather than an invisible build step.

Serving it from `public/` and fetching at runtime keeps it out of the initial bundle, lets it be cached separately, and makes the game version an explicit part of the payload.

Because the data arrives over the wire rather than through a typed import, its shape must be validated at the boundary rather than assumed.