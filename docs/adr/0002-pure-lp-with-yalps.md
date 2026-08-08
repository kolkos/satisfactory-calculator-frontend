# Machine counts are continuous, so the model is a pure LP solved by YALPS

Machines in Satisfactory can be underclocked, so "2.5 Constructors" is not a rounding artefact but a buildable arrangement: three machines with the last at 50%. Keeping machine counts continuous keeps the model a pure linear program, which YALPS (MIT, ~240kB, pure TypeScript, one dependency) solves in milliseconds. Integer machine counts would make it a MILP requiring branch-and-bound.

Overclocking is excluded on purpose. Fractional counts only ever mean a machine running below 100%, so a count of `n` maps unambiguously to `ceil(n)` buildings with the last at the fractional remainder. Raising a machine above 100% to reduce building count looks like a free optimisation and is not one: it would require Power Shards, and it invalidates every unclocked rate the data is built from.

## Considered Options

- **MILP with integer machine counts**, solved by `highs` (~3.5MB) or `glpk.js` (~2.6MB) compiled to WebAssembly. Rejected on two grounds: `angular.json` sets an initial-bundle `maximumError` of 1MB, and rounding machine counts up forces overproduction, which corrupts the scarcity optimum the model exists to find.
- **Continuous solve, integer display.** Round up in the UI and show the resulting overproduction. Rejected because the displayed plan would then differ from the plan that was optimised.

## Consequences

YALPS treats the objective as a named constraint row, so phase 2 of ADR-0001 reuses the same model: swap `objective` to the machine-count row and add an upper bound on the scarcity row at the phase-1 optimum. That bound needs a small relative tolerance, or floating-point error makes phase 2 spuriously infeasible.

Variables are implicitly non-negative in YALPS, which matches recipe rates exactly — no extra bounds needed.

The 106 alternate recipes mean Unlock Value costs up to ~212 solves per plan. Pruning candidates by "does this alternate produce a Part already in the plan" is unsound: the Polymer Resin alternate produces a Part absent from a base Rubber plan, yet the base Residual Rubber recipe consumes it, so admitting it can still improve the plan. All alternates must be solved. The optimiser is therefore a pure, synchronous, DOM-free function with a web worker as a thin adapter — tests run against the function, and the worker boundary stays reversible.