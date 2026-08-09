# Recipe data is generated from a community mirror, committed to git, and served as a static asset

An npm script fetches the Satisfactory Calculator game-data JSON, trims it to what the planner needs, stamps it, writes it into `public/`, and that output is committed. Resource Weights come from a second source and are merged into the same file. The unmodified upstream response is committed too, outside the served directory, so the trimmed output can always be re-derived from the bytes it actually came from.

This originally read `Docs.json` from a local Satisfactory installation via `satisfactory-docs-parser`. That was abandoned before implementation: `Docs.json` exists only inside a game install, the game does not run on this project's development machine, and so the "a developer runs it locally" premise did not hold for the only developer. The generate-and-commit decision itself is unchanged; only the source is.

## Considered Options

- **`Docs.json` from a local game install.** The authoritative source, carrying a real game version. Rejected because obtaining it means copying a file off a separate machine before the dataset can be regenerated at all — a manual step outside the repository that blocks anyone without the game.
- **`@satisfactory-dev/docs.json.ts`.** Ships JSON Schemas and generated TypeScript types for `Docs.json`, not the data — its only data file is a single-entry stub — and the published version has no 1.2 schema. It solves typing, not sourcing.
- **Parse during the build.** Nothing derived in git, but it makes the build depend on a third party being reachable, and two builds of the same commit could produce different apps.
- **Import the JSON into the bundle.** Type-safe with no runtime validation or loading state, but a bundler inlines the import into the JS chunk, where it counts against the 1MB initial-bundle error budget in `angular.json`.
- **Fetch the mirror at runtime.** Always current without regeneration, but it introduces a network dependency and a third party into an app that is deliberately entirely clientside. It is also impossible: the mirror's `Access-Control-Allow-Origin` names only its own domain, so a browser request from this app would be refused.

## Consequences

Generated data lives in version control, which normally deserves suspicion. The reason it is correct here is recorded above; regenerating is a deliberate, reviewable act rather than an invisible build step.

Serving it from `public/` and fetching it at runtime keeps it out of the initial bundle and lets it be cached separately. Because it arrives over the wire rather than through a typed import, its shape is validated at the boundary rather than assumed.

The stamp is no longer a game version. The mirror reports only `branch: "Stable"`, so the dataset records where it came from, when it was fetched, and the source's `ETag` instead. That is weaker than a version number and is the real cost of this choice: two datasets stamped "Stable" may differ.

Committing the raw upstream response alongside the trimmed output is what makes that cost survivable. The mirror mutates in place at a fixed URL, so without a snapshot there is no way to tell what a committed dataset was derived from, or what changed upstream between two refreshes — a diff of the trimmed file shows that something moved, never why. It costs roughly 1.5 MB per refresh in history, against an 87 kB served asset. Refreshes are rare and deliberate, so the history grows slowly.

We now depend on a third party continuing to publish, and on their derived data being right. This is mitigated by the data being committed — a mirror going away breaks regeneration, not the app — and by the boundary rejecting anything malformed rather than trusting it.

Resource Weights are not in the mirror, which carries no node counts. They come from the hardcoded node table inside `satisfactory-docs-parser` and are computed rather than taken whole, because that package's own `maxExtraction` assumes overclocking, which no Plan in this project ever does.