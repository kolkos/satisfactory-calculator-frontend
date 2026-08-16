# The Extractor Tier is part of the Plan Request, and Resource Weights are computed per Request

Which Miner generation a Plan assumes — Mk.1, Mk.2 or Mk.3 — is chosen per Request rather than fixed, and it is not merely a display detail: it feeds the Resource Weights and therefore changes which Recipes the optimiser picks. Weights can no longer be precomputed into the dataset; the dataset carries the node structure and the weights are derived at solve time. The default is Mk.3.

## Why it is not a display detail

Only mined Resources have tiers. The Oil Extractor, Water Extractor and Resource Well Extractor each exist in exactly one version, while Miners come in three spanning a factor of four. Since a Resource Weight is `1 / (total available per minute across the map)`, raising the tier divides every ore's weight by up to four and leaves every fluid's untouched.

That is a real change in the answer, not a rounding difference. Solving the committed dataset for the same Targets at Mk.1 and at Mk.3, with every Alternate unlocked, returns different chains:

| Target          | Mk.1 chooses                                  | Mk.3 chooses                          |
| --------------- | --------------------------------------------- | ------------------------------------- |
| Steel Ingot     | Coke Steel Ingot, via Petroleum Coke from oil | Solid Steel Ingot and Pure Iron Ingot |
| Computer        | Circuit Board and Insulated Cable             | the Caterium Computer line throughout |
| Aluminum Casing | Residual Plastic                              | Residual Rubber                       |

The pattern is consistent: when ore is scarce relative to oil, the optimiser reaches for oil-based routes; when four times as much ore is available and oil is unchanged, oil becomes the binding constraint and it switches to ore-heavy routes. Both answers are correct for the factory they describe.

(An earlier draft of this ADR argued the same point from hand arithmetic on two steel recipes in isolation, and got the direction of that particular comparison wrong. Comparing recipes one against another is not enough — what matters is the cost of the whole chain behind each, including what its byproducts save elsewhere. The table above comes from running the solver.)

## Considered Options

- **Fix it at Mk.1.** What the data already assumed. Conservative and always buildable, but at Mk.3 it understates ore capacity fourfold and makes the optimiser hoard oil that does not need hoarding.
- **Fix it at Mk.3.** One number, no setting. Rejected once the effect on Recipe selection was understood: a fixed tier silently imposes an endgame view of scarcity on an early-game player, and there is no way to ask the other question.
- **Put it in the Unlock Profile.** Conceptually tidy — Mk.2 and Mk.3 are milestone unlocks at Tier 4 and Tier 8, much as Alternates are Hard Drive unlocks. Rejected because it describes the question rather than the questioner: "what would this cost me with better miners" is a comparison a single player wants to make, and the Profile is persisted per player while a Request is shareable.

## Consequences

`Resource.weight` cannot live in the dataset any more. The dataset carries what the map holds — node counts by purity and the base rate of the extractor that works them — and the weight for a given tier is derived when a Plan is solved. This is a better division anyway: the dataset describes the game, the Request describes the question.

The Request goes in the URL, so a shared link reproduces the tier along with the Targets. The Unlock Profile stays in local storage, because it describes the person rather than the question.

Machine counts for extraction assume **normal** node purity — the "default extraction rate" the game itself quotes. The true figure is undefined without assigning nodes: iron has 39 impure, 42 normal and 46 pure nodes, so 600 ore/min is anywhere between 1.25 and 5 Mk.3 Miners. Choosing nodes is explicitly out of scope, so the nominal rate is quoted and the player adjusts from what they know about their own site. Note that this deliberately differs from the weight calculation, which uses each Resource's true purity mix: the weight is about what the map can supply in total, the machine count is about one representative machine.

The default is Mk.3, on the grounds that someone reaching for a production planner is usually past the early game.

Machine counts for extraction come out under the extractor's own building name, so a Plan at Mk.3 reports Miner Mk.3 beside its Smelters and Constructors.
