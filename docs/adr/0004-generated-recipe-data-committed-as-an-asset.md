# Recipe data is generated from the wiki's Docs templates, committed to git, and served as a static asset

An npm script fetches the Satisfactory wiki's `Template:DocsItems.json`, `Template:DocsRecipes.json` and `Template:DocsBuildings.json` through the MediaWiki API, trims them to what the planner needs, stamps them with each template's revision id, writes the result into `public/`, and that output is committed. Resource Weights come from a second source and are merged into the same file. The unmodified upstream responses are committed too, outside the served directory, so the trimmed output can always be re-derived from the bytes it actually came from.

This decision was reached in three steps, and the intermediate reasoning is worth keeping. It first read `Docs.json` from a local Satisfactory installation via `satisfactory-docs-parser`. That was abandoned because `Docs.json` exists only inside a game install, the game does not run on this project's development machine, and so the "a developer runs it locally" premise did not hold for the only developer. It then used the Satisfactory Calculator mirror, which is real, parsed data needing no installation. The wiki templates displaced that in turn because they publish the same data with every field the planner needs stated outright — see below. The generate-and-commit decision itself never changed; only the source did.

## Considered Options

- **`Docs.json` from a local game install.** The authoritative source, carrying a real game version. Rejected because obtaining it means copying a file off a separate machine before the dataset can be regenerated at all, which blocks anyone without the game. (If it is ever revisited: the file is UTF-16LE with a BOM, and reading it as UTF-8 yields mojibake.)
- **`@satisfactory-dev/docs.json.ts`.** Ships JSON Schemas and generated TypeScript types for `Docs.json`, not the data — its only data file is a single-entry stub — and the published version has no 1.2 schema. It solves typing, not sourcing.
- **The Satisfactory Calculator mirror.** One endpoint instead of three, and it works. Rejected once the wiki templates were found, because every field it lacks has to be inferred: Part State from a display category, alternates from the `"Alternate: "` name prefix, and production recipes from guessing at building names. Each inference is a place to be silently wrong, and one of them was — its name-prefix rule counts 109 alternates where the true number is 106.
- **Parse during the build.** Nothing derived in git, but it makes the build depend on a third party being reachable, and two builds of one commit could produce different apps.
- **Import the JSON into the bundle.** Type-safe with no runtime validation or loading state, but a bundler inlines the import into the JS chunk, where it counts against the 1MB initial-bundle error budget in `angular.json`.
- **Fetch upstream at runtime.** Always current without regeneration, but it introduces a network dependency and a third party into an app that is deliberately entirely clientside.

## Consequences

Generated data lives in version control, which normally deserves suspicion. The reason it is correct here is recorded above; regenerating is a deliberate, reviewable act rather than an invisible build step.

Serving it from `public/` and fetching it at runtime keeps it out of the initial bundle and lets it be cached separately. Because it arrives over the wire rather than through a typed import, its shape is validated at the boundary rather than assumed — and the generation script runs that same boundary over its own output, so a dataset that would fail at runtime fails while someone is watching.

Every field the transformation needs is stated by the source rather than inferred: `form` gives Part State directly and keeps gases distinct from fluids, `alternate` is a boolean, and `inBuildGun` / `inCustomizer` / `producedIn` say plainly which recipes a machine can run. The transformation therefore contains no heuristics, which is the whole reason this source was preferred.

The dataset is versioned after all. An earlier draft recorded losing the game version as this decision's main cost; that no longer holds. The wiki publishes no version number either, but each template has a monotonic revision id, and the dataset records all three. Two datasets with the same revisions were built from the same bytes, which is what a version number was wanted for.

We depend on a third party continuing to publish, and on their data being right. This is mitigated by the data being committed — the wiki going away breaks regeneration, not the app — by the snapshot making regeneration auditable, and by the boundary rejecting anything malformed rather than trusting it.

Committing the raw upstream responses costs roughly 1.1 MB per refresh in history, against a 127 kB served asset. Refreshes are rare and deliberate, so the history grows slowly.

Resource Weights are not in the wiki templates, which carry no map data. They are transcribed by hand from the wiki's Resource Node and Resource Well pages and computed as described in ADR-0001.