# The Sankey diagram is hand-built in SVG, not drawn with a charting library

Optimus UI ships a `chart` component wrapping Chart.js, so reaching for `chartjs-chart-sankey` is the obvious move. We are not doing that, for two independent reasons: the optimal plans this app produces contain cycles, which no maintained Sankey library handles, and Chart.js renders to canvas, which cannot meet the accessibility bar this repo sets for itself.

## Considered Options

- **`chartjs-chart-sankey`** — fits Optimus UI, actively maintained, but [issue #1](https://github.com/kurkle/chartjs-chart-sankey/issues/1) ("cannot handle circular flows") has been open since July 2020 and the library performs no cycle check, so bad input fails silently rather than loudly.
- **`d3-sankey`** — describes itself as visualising "flow between nodes in a directed *acyclic* network". Unmaintained since 2022.
- **`d3-sankey-circular`** — genuinely handles cycles and only computes layout, leaving us to render SVG. Rejected on staleness: also untouched since 2022, at v0.34.0.
- **A layered node-link graph instead of a Sankey.** Sidesteps cycles, but loses the proportional band widths that show where the volume actually is.

## Consequences

Cycles are guaranteed, not hypothetical. Recycled Plastic (Rubber + Fuel → Plastic) and Recycled Rubber (Plastic + Fuel → Rubber) are mutually dependent and are the most oil-efficient route to both parts, so a scarcity-minimising solver selects them whenever both are unlocked. The renderer must handle back-edges as a normal case.

`AGENTS.md` requires passing all AXE checks and WCAG AA. A canvas Sankey is a single opaque element to screen readers and keyboards, reachable only by shipping a parallel data table. SVG nodes can be focusable and labelled individually.

Layout is cheaper here than in the general case: production chains have a natural depth from raw Resources, which fixes x-positioning. Compute layers on the graph with back-edges removed, then draw those back-edges explicitly as loops.

The graph is bipartite: Recipe nodes and Part nodes alternate, rather than Recipes linking to each other directly. This is forced by what the solver produces. It yields a total production and a total consumption per Part but no matching between them, so if two recipes make Iron Ingot and three consume it, drawing recipe-to-recipe edges would invent an allocation the solver never computed. A Part node in between states only what is known. Recipe nodes carry the machine count and the building type; Part nodes carry the throughput at that point. Extraction nodes form the left edge and are the Resource Demand; Targets and Surplus terminate the right.

Link width is linearly proportional to Rate on a single scale, with a small minimum so thin flows stay visible and clickable. Water-heavy chains will therefore look lopsided, and a Sankey mixing m³/min with items/min on one scale is comparing unlike things. Both are accepted: the alternatives — separate scales per phase, or a square-root scale — break the one promise a Sankey makes, that width is quantity and what goes in comes out.

The cost is real — roughly 400 lines of layout and rendering that a dependency would otherwise provide. Accepted because every alternative is either a dead end or a dead project.