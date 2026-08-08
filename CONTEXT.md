# Satisfactory Production Planner

A clientside Angular app that takes a target part and derives the full production chain needed to make it — every intermediate part, the recipes to use, and the raw resources consumed — then visualises the result as a Sankey diagram.

The glossary is in English because the game's own vocabulary is English and those terms appear verbatim in `Docs.json` and in the code. Conversations about the project may be in Dutch; the model is not.

## Language

### Materials and recipes

**Part**:
Anything that flows through a production chain, whatever its Part State.
_Avoid_: Item, material, product, component

**Part State**:
Whether a Part is solid, fluid or gas — a closed set of three, never a solid/not-solid flag, because nitrogen gas is neither. Solids are counted in items/min and can be sunk directly. Fluids and gases are measured in m³/min, travel by pipe, and cannot be sunk without being packaged first.
_Avoid_: Type, kind, form, phase, isFluid

**Resource**:
A Part with no recipe: extracted directly from the map rather than produced. Ore, crude oil, water, nitrogen gas. The leaves of every production chain.
_Avoid_: Raw material, input, ingredient

**Recipe**:
A conversion of input Parts into output Parts at a fixed rate in a specific building type. May have more than one output, in which case the secondary ones are Byproducts.
_Avoid_: Formula, conversion, process recipe

**Extraction**:
A Recipe with no inputs that yields a Resource, costing one machine per extractor's worth of throughput. Modelling it as an ordinary Recipe is what stops the optimiser squandering unbounded Resources: water carries no Scarcity Cost, but 10,000 m³/min still costs 84 extractors, and the second optimisation phase counts them.
_Avoid_: Mining, harvesting, source, input node

**Alternate**:
A Recipe that is not a Part's default, and must be unlocked through Hard Drive research before it can be used. Which Alternates a given save offers is randomised, so the app can never derive them — only ask.
_Avoid_: Alt recipe, alternative recipe, variant

**Unlock Profile**:
The set of Alternates a particular player has unlocked. Persisted locally, defaults to empty, and acts purely as a filter on which Recipes the optimiser may use.
_Avoid_: Settings, unlocks, save, progression

**Unlock Value**:
For a locked Alternate, how much cheaper a plan becomes if it were unlocked — computed by re-solving with that Alternate admitted. Lets the app rank what is worth researching next. Expressed to the player as the change in Resource Demand, not as a change in Scarcity Cost.
_Avoid_: Gain, benefit, score, saving

### Planning

**Rate**:
A throughput, always per minute: items/min for solid Parts, m³/min for fluids and gases. No other time unit appears anywhere in the app.
_Avoid_: Throughput, speed, per-second, flow rate

**Target**:
A Part together with the Rate the player wants of it. A Plan is driven by one or more Targets, and each one becomes a single constraint row in the model — which is why supporting several costs the optimiser nothing.
_Avoid_: Goal, output, demand, request

**Plan**:
The full answer to a set of Targets: which Recipes to run and at what Rate, how many machines of each building type, the resulting Resource Demand, and any Surplus. Machine counts are fractional, because underclocking makes a fractional machine genuinely buildable: a count of 2.5 means three machines with the last at 50%.
_Avoid_: Chain, solution, result, build

**Clock Speed**:
The rate a machine runs at, never above 100% in any Plan. Underclocking is what makes fractional machine counts buildable; overclocking is deliberately excluded, so no Plan ever assumes Power Shards, and Somersloop amplification is out of scope for the same reason. Every rate in the data — Miner Mk.1 at 60/min, a Water Extractor at 120 m³/min — is an unclocked rate.
_Avoid_: Overclock, clock, speed, efficiency

### Optimisation

**Resource Weight**:
The scarcity price of one unit per minute of a Resource, defined as `1 / (total available per minute of that Resource across the whole map)`. Water is the only Resource with no limit — extractors need no node and can be placed on any lake — so it alone weighs zero. Every other Resource is finite and priced accordingly, including the gases: nitrogen comes from six resource wells and is genuinely scarce. Part State says nothing about scarcity.
_Avoid_: Cost, price, multiplier

**Scarcity Cost**:
The single scalar the optimiser minimises: the sum of each consumed Resource's Rate multiplied by its Resource Weight. Internal to the solver and never shown to the player — it exists only because an LP needs one objective, and it is what makes the optimiser spend abundant Resources to save scarce ones. Not a feasibility measure: a Scarcity Cost under 1 does mean the plan fits on the map, but above 1 proves nothing, since 60% of the iron plus 60% of the copper sums past 1 while remaining perfectly buildable.
_Avoid_: Map Share, score, cost, total resources, weighted resources

**Resource Demand**:
The headline output of a plan: for each Resource, the Rate the plan needs. This is what the player is told — "you need 600 m³/min of crude oil" — and it deliberately says nothing about how to extract it. No miner tiers, no node assignments, no overclocking advice.
_Avoid_: Resource cost, shopping list, inputs, raw totals

**Optimal Plan**:
The plan chosen by lexicographic optimisation: first minimise Scarcity Cost, then — holding Scarcity Cost at that minimum — minimise the number of machines. Never a single weighted trade-off between the two; the second objective only breaks ties in the first.
_Avoid_: Best plan, cheapest plan

### Flow

**Byproduct**:
A recipe's secondary output — Heavy Oil Residue from the Plastic recipe. A property of a Recipe, and always produced whether anyone wants it or not.
_Avoid_: Waste, residue, secondary product

**Surplus**:
A part the plan produces more of than it consumes, left over for the player to deal with. A property of a Plan, not of a Recipe: a Byproduct that the plan finds a use for never becomes Surplus. The plan's stated throughput only holds if the player actually clears its Surplus, so it is presented as an open task rather than a footnote.
_Avoid_: Waste, overflow, excess, leftover, residue