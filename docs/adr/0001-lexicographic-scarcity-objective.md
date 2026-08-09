# Optimal plans minimise scarcity-weighted resources, then machines, lexicographically

"Optimal" is not a property of a production chain — it is a choice of objective, and different objectives pick different recipes. We minimise Scarcity Cost (each Resource's rate priced at `1 / total available per minute on the map`) rather than machine count or power, because that is the constraint players actually feel: ore nodes are finite and water is not. Machine count is then minimised as a strict second phase, holding Scarcity Cost at its optimum.

## Considered Options

- **Minimise machine count.** Almost always picks base recipes and ignores scarcity entirely, which makes the whole LP hard to justify.
- **Minimise power draw.** Requires per-building power data and overclock modelling for a goal few players optimise for.
- **Unweighted resource units.** Treats 1 m³ of water as equal to 1 unit of uranium. Water is unbounded — extractors have no node limit — so this produces nonsense.
- **Single blended objective** (`scarcity + ε × machines`). One solve instead of two, but ε needs tuning: too large distorts the scarcity optimum, too small vanishes into floating-point noise. The two-phase form is exact and needs no constant.

## Consequences

Phase 2 is not optional. Minimising scarcity alone leaves the solver indifferent between plans of equal cost, so results would vary between runs, and it would happily spend 200 Refineries on a recycling loop to save a trickle of ore. Phase 2 makes the answer both deterministic and buildable.

Scarcity Cost stays internal. It is a price mechanism for the solver, not a number for the player, who sees Resource Demand instead. It is also not a feasibility measure: below 1 the plan certainly fits on the map, but above 1 proves nothing, since 60% of the iron plus 60% of the copper sums past 1 while remaining perfectly buildable.

Extraction is modelled as an ordinary input-less Recipe with a machine cost, not as a boundary condition. Without that, Resources whose weight is effectively zero — water above all, since extractors have no node limit — would be free in both phases, and the optimiser would happily demand 10,000 m³/min to save a single unit of ore. Counting extractors in phase 2 prices them as buildings instead of inventing a weight for them.

Resource Weights assume **default world generation**. Since 1.2 a new save can opt into World Randomization, which reshuffles which resource each deposit yields and at what purity — the total number of deposits is unchanged, but the split between them is not. That is a per-save choice made at world creation and cannot be turned off afterwards, and it is off by default, so one table computed from the standard map is correct for an ordinary playthrough and wrong for a randomized one. Per-save weights are out of scope; if they are ever wanted, the world seed is visible in-game and would be the input.

The Resource Weight table is a second data source. Neither `Docs.json` nor the community mirror in ADR-0004 carries map data, so node counts come from the hardcoded table inside `satisfactory-docs-parser`. Totals are computed from those counts × purity multiplier × miner rate rather than taken ready-made: published per-minute totals disagree with each other, at least one contradicts the node distribution printed on the same page, and that package's own `maxExtraction` assumes overclocking, which no Plan here ever does. Baseline is Miner Mk.1 at 100%. The counts cross-check against hand arithmetic — iron's 33 impure, 41 normal, 46 pure agree. Between mined ores the tier scales uniformly so relative weights hold, but the ratio between solid ores and fluids does shift with tier. That imprecision is accepted, not hidden.