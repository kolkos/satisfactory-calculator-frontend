import { greaterEq, lessEq, solve as solveLp } from 'yalps';
import {
  extractorFor,
  resourceWeight,
  type Dataset,
  type ExtractorTier,
} from '../dataset/parse-dataset';

/** A Part together with the Rate the player wants of it. */
export interface Target {
  readonly part: string;
  readonly rate: number;
}

/**
 * Everything that defines the question a Plan answers. The Extractor Tier belongs
 * here rather than to the player because "what would this cost with better
 * miners" is a comparison one player wants to make — see ADR-0006.
 */
export interface PlanRequest {
  readonly targets: readonly Target[];
  readonly extractorTier?: ExtractorTier;
}

const DEFAULT_TIER: ExtractorTier = 3;
const TIERS: readonly ExtractorTier[] = [1, 2, 3];

/**
 * The Alternates a particular player has unlocked, by Recipe id. Purely a filter
 * on which Recipes may enter the model. Empty is valid and is where every player
 * starts, so it is the default.
 */
export type UnlockProfile = ReadonlySet<string>;

const NO_UNLOCKS: UnlockProfile = new Set<string>();

/**
 * One Recipe running in a Plan. `machines` is continuous: 2.5 means three
 * machines with the last underclocked to 50%, never one machine above 100%.
 * Every Rate this Recipe moves is `machines` times its rate in the Dataset.
 */
export interface PlannedRecipe {
  readonly recipe: string;
  readonly building: string;
  readonly machines: number;
}

export interface Plan {
  readonly recipes: readonly PlannedRecipe[];
  readonly machinesByBuilding: Readonly<Record<string, number>>;
  readonly resourceDemand: Readonly<Record<string, number>>;
  /**
   * Parts the Plan makes more of than it uses, by Rate. A Byproduct the chain finds
   * a use for never appears here. The Plan's stated throughput only holds if these
   * are actually cleared — an unconsumed fluid backs up and stalls the machine
   * producing it, taking the main product down with it — so this is an open task
   * rather than a footnote.
   */
  readonly surplus: Readonly<Record<string, number>>;
}

/**
 * Infeasible is a distinct result rather than an empty Plan, so a caller can tell
 * "impossible" apart from "nothing to do". `failed` is distinct again: the solver
 * gave up rather than proved anything, so "we could not work it out" must not be
 * shown to a player as "this cannot be built".
 */
export type SolveResult =
  | { readonly status: 'optimal'; readonly plan: Plan }
  | { readonly status: 'infeasible'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string };

/**
 * The two objective rows, minimised in that order. Internal to the solver; neither
 * surfaces in a Plan. Prefixed so they cannot collide with a Part id, which is
 * what every other row is keyed by.
 */
const SCARCITY_COST = '@scarcityCost';
const MACHINES = '@machines';

const RECIPE = 'recipe:';
const EXTRACT = 'extract:';

/**
 * How far phase two may let Scarcity Cost drift above phase one's optimum, relative
 * to that optimum. It only has to absorb the difference between summing the same
 * numbers in two different orders, because the ceiling is computed from phase one's
 * own solution rather than from the figure the solver reports.
 *
 * Keeping it this small matters more than it looks. Whatever slack is allowed buys
 * phase two a sliver of a Recipe phase one rejected, and the size of that sliver is
 * the slack divided by a Resource Weight — so at a realistic weight near 1e-5, a
 * fixed slack is magnified a hundred thousand times. An absolute 1e-8 was tried
 * first and put a visible 0.0002-machine ghost of the losing Recipe into the answer.
 */
const SCARCITY_SLACK = 1e-12;

/**
 * Below this a solver value is noise rather than a plan. Variables are either
 * machine counts or Rates per minute, and neither is meaningful this small: a
 * ten-thousandth of a machine is nothing, and an item every ten thousand minutes
 * is one a week. A model with a few hundred Recipes accumulates float residue of
 * roughly this size, and without the threshold it reaches the Plan — a solve for
 * Uranium Fuel Rod reported a millionth of a unit of Bauxite as Surplus, which is
 * not a thing that can happen to a Resource.
 */
const NEGLIGIBLE = 1e-4;

/**
 * What a reported number is rounded to. Coarser than the solver's own precision
 * on purpose: phase two can spend its slack pushing a value a hair off a round
 * figure, and 49.99999995 ore a minute is 50.
 */
const PLAN_PRECISION = 1e6;

/**
 * Rounds a number on its way into a Plan, whether it came straight from a solver
 * variable or was accumulated across several. Accumulation is the reason this
 * cannot be left to the solver's own rounding: adding two rounded values makes
 * fresh dust, and 0.1 + 0.2 machines reaches a player as 0.30000000000000004.
 */
function reported(value: number): number {
  return Math.round(value * PLAN_PRECISION) / PLAN_PRECISION;
}

export function solve(
  dataset: Dataset,
  request: PlanRequest,
  profile: UnlockProfile = NO_UNLOCKS,
): SolveResult {
  const tier = request.extractorTier ?? DEFAULT_TIER;
  // A Request may have come from a URL or saved JSON, where the type is a promise
  // rather than a guarantee. An out-of-range tier would index past a Resource's
  // extractors and throw, breaking the contract that every failure is a status.
  if (!TIERS.includes(tier)) {
    return { status: 'infeasible', reason: `Extractor Tier ${String(tier)} is not Mk.1, 2 or 3` };
  }

  // An Alternate the player has not researched is not a Recipe they can build, so
  // it never becomes a variable. Filtering here rather than penalising it in the
  // objective keeps "cannot build" and "not worth building" separate.
  const admissible = dataset.recipes.filter(
    (recipe) => !recipe.alternate || profile.has(recipe.id),
  );

  const demanded = new Map<string, number>();
  for (const target of request.targets) {
    // A zero, negative or NaN Rate would sail through as a row that constrains
    // nothing, and the caller would get an empty Plan indistinguishable from a
    // legitimately trivial one.
    if (!Number.isFinite(target.rate) || target.rate <= 0) {
      return {
        status: 'infeasible',
        reason: `Target "${target.part}" needs a Rate greater than zero`,
      };
    }
    demanded.set(target.part, (demanded.get(target.part) ?? 0) + target.rate);
  }

  for (const part of demanded.keys()) {
    if (!dataset.parts.some((candidate) => candidate.id === part)) {
      return { status: 'infeasible', reason: `unknown Part "${part}"` };
    }
  }

  // One row per Part. Production must at least meet consumption plus any Target;
  // the inequality is deliberate, so a forced Byproduct cannot make a chain
  // infeasible just because nothing consumes it.
  const constraints: Record<string, ReturnType<typeof greaterEq>> = {};
  for (const part of dataset.parts) {
    constraints[part.id] = greaterEq(demanded.get(part.id) ?? 0);
  }

  const variables: Record<string, Record<string, number>> = {};

  // Every variable counts machines, so its coefficient in a Part's row is that
  // Part's net rate through one machine.
  for (const recipe of admissible) {
    const column: Record<string, number> = { [SCARCITY_COST]: 0, [MACHINES]: 1 };
    for (const input of recipe.inputs) {
      column[input.part] = (column[input.part] ?? 0) - input.rate;
    }
    for (const output of recipe.outputs) {
      column[output.part] = (column[output.part] ?? 0) + output.rate;
    }
    variables[`${RECIPE}${recipe.id}`] = column;
  }

  // Extraction is an ordinary input-less Recipe run by an extractor, which is what
  // gives an unbounded Resource a price after all: water carries no Scarcity Cost,
  // but 10,000 m³/min is still 84 Water Extractors, and phase two counts them.
  //
  // The variable is the Rate extracted, not the number of extractors, so that the
  // Rate a player is told comes straight out of the solver rather than through a
  // multiplication that would magnify its rounding by the extractor's throughput.
  // One extractor's worth of Rate therefore costs one machine.
  const extractors = new Map<string, { building: string; rate: number }>();
  for (const resource of dataset.resources) {
    const extractor = extractorFor(resource, tier);
    extractors.set(resource.part, extractor);
    variables[`${EXTRACT}${resource.part}`] = {
      [resource.part]: 1,
      [SCARCITY_COST]: resourceWeight(resource, tier),
      [MACHINES]: 1 / extractor.rate,
    };
  }

  const model = { direction: 'minimize', constraints, variables } as const;

  const cheapest = solveLp({ ...model, objective: SCARCITY_COST });
  if (cheapest.status === 'infeasible') {
    return { status: 'infeasible', reason: 'no combination of Recipes meets the Targets' };
  }
  if (cheapest.status !== 'optimal') {
    // "unbounded", "timedout" and "cycled" are the solver failing, not a proof
    // that the Targets cannot be built.
    return { status: 'failed', reason: `solver returned "${cheapest.status}"` };
  }

  // The ceiling comes from phase one's own solution rather than from the objective
  // value the solver reports, which is rounded to its precision and so may sit just
  // below what any real plan can achieve — forcing a slack big enough to be abused.
  // Priced from the returned variables, phase one's plan is by construction still
  // feasible in phase two, so the slack need only cover summation order.
  let optimum = 0;
  for (const [key, value] of cheapest.variables) {
    optimum += value * (variables[key]?.[SCARCITY_COST] ?? 0);
  }

  // Phase two: the same model with the objective swapped and that ceiling applied,
  // so machines are minimised only among the plans that were already the cheapest.
  // Not a weighted blend of the two — the second objective may not buy a single
  // machine at the price of any extra Resource.
  const solution = solveLp({
    ...model,
    objective: MACHINES,
    constraints: {
      ...constraints,
      [SCARCITY_COST]: lessEq(optimum + Math.abs(optimum) * SCARCITY_SLACK),
    },
  });
  if (solution.status !== 'optimal') {
    return {
      status: 'failed',
      reason: `machine-minimising phase returned "${solution.status}"`,
    };
  }

  const recipesById = new Map(admissible.map((recipe) => [recipe.id, recipe]));
  const recipes: PlannedRecipe[] = [];
  const machinesByBuilding: Record<string, number> = {};
  const resourceDemand: Record<string, number> = {};

  // What the Plan nets out at for each Part, accumulated from the same coefficients
  // the model was built from, so it cannot drift from what the solver balanced.
  const net = new Map<string, number>();

  for (const [key, value] of solution.variables) {
    if (value <= NEGLIGIBLE) continue;

    for (const [row, coefficient] of Object.entries(variables[key] ?? {})) {
      if (row === SCARCITY_COST || row === MACHINES) continue;
      net.set(row, (net.get(row) ?? 0) + value * coefficient);
    }

    if (key.startsWith(RECIPE)) {
      const recipe = recipesById.get(key.slice(RECIPE.length));
      if (recipe === undefined) continue;
      recipes.push({ recipe: recipe.id, building: recipe.building, machines: reported(value) });
      machinesByBuilding[recipe.building] = reported(
        (machinesByBuilding[recipe.building] ?? 0) + value,
      );
    } else if (key.startsWith(EXTRACT)) {
      const part = key.slice(EXTRACT.length);
      const extractor = extractors.get(part);
      if (extractor === undefined) continue;
      resourceDemand[part] = reported(value);
      machinesByBuilding[extractor.building] = reported(
        (machinesByBuilding[extractor.building] ?? 0) + value / extractor.rate,
      );
    }
  }

  // Whatever a Part nets beyond what was asked for is left over. Targets are met
  // exactly, so they do not appear; a Resource extracted to order nets zero, so it
  // does not either. Only a Byproduct the chain found no use for survives here.
  const surplus: Record<string, number> = {};
  for (const [part, produced] of net) {
    const left = produced - (demanded.get(part) ?? 0);
    if (left > NEGLIGIBLE) surplus[part] = reported(left);
  }

  return { status: 'optimal', plan: { recipes, machinesByBuilding, resourceDemand, surplus } };
}
