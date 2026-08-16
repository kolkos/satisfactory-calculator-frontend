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

The Resource Weight table is a second data source, transcribed by hand: no source of recipe data carries map data. Node counts come from the wiki's Resource Node and Resource Well pages, and totals are computed from counts × purity multiplier × the extractor's unclocked rate rather than taken ready-made — published per-minute totals assume a Miner Mk.3 at 250%, and no Plan here ever exceeds 100%.

Which miner generation those rates assume is a per-Request choice rather than a constant — see ADR-0006, which supersedes the fixed Miner Mk.1 baseline this ADR originally assumed.

Getting these numbers right took three attempts and they should not be edited casually. `satisfactory-docs-parser`'s hardcoded table and two community summaries each gave different counts for iron and copper, and one omitted SAM entirely. The wiki's table was chosen because it is the only one that is internally consistent: its published "maximum per min" column is exactly the computed unclocked total times 10 for mined resources (Mk.3 ×4, overclock ×2.5) and times 2.5 for extracted fluids, for all thirteen Resources. That identity is asserted in the tests, so a mistyped count cannot pass unnoticed. Between mined ores the tier scales uniformly so relative weights hold, but the ratio between solid ores and fluids does shift with tier. That imprecision is accepted, not hidden.