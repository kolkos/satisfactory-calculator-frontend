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
 * How far phase two may let Scarcity Cost drift above the optimum phase one found.
 * Some slack is needed because re-solving cannot reproduce a float exactly, and a
 * bound of exactly the optimum would be spuriously infeasible.
 *
 * It is the solver's own precision, and deliberately absolute rather than relative
 * to the optimum. Any slack lets phase two buy machines with a sliver of a Recipe
 * phase one rejected; keeping it no larger than the precision phase one was
 * computed to means the sliver is smaller than the solver reports, so it never
 * reaches the Plan. A relative tolerance of 1e-6 was tried first and did reach it,
 * putting a 5e-8-machine ghost of the losing Recipe into the answer.
 */
const SCARCITY_SLACK = 1e-8;

/**
 * Below this a solver value is noise rather than a plan. Variables here are either
 * machine counts or Rates per minute, and in this game the smallest either
 * meaningfully takes is many orders of magnitude above a millionth — so anything
 * smaller is the residue of the slack above, not a Recipe anyone runs.
 */
const NEGLIGIBLE = 1e-6;

/**
 * What a reported number is rounded to. Coarser than the solver's own precision
 * on purpose: phase two can spend its slack pushing a value a hair off a round
 * figure, and 49.99999995 ore a minute is 50.
 */
const PLAN_PRECISION = 1e6;

/**
 * Rounds a machine count accumulated across Recipes. Individual variables arrive
 * already rounded by the solver, but adding two rounded values makes fresh dust —
 * 0.1 + 0.2 is 0.30000000000000004 — and the sum is the number a player sees.
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

  // Phase two: the same model with the objective swapped and phase one's result
  // pinned as a ceiling, so machines are minimised only among the plans that were
  // already the cheapest. Not a weighted blend of the two — the second objective
  // may not buy a single machine at the price of any extra Resource.
  const solution = solveLp({
    ...model,
    objective: MACHINES,
    constraints: { ...constraints, [SCARCITY_COST]: lessEq(cheapest.result + SCARCITY_SLACK) },
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

  // Per-variable values arrive already rounded by the solver, so they are taken as
  // they come. Only the accumulated machine counts are rounded again, because
  // adding rounded values is what reintroduces dust.
  for (const [key, value] of solution.variables) {
    if (value <= NEGLIGIBLE) continue;

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

  return { status: 'optimal', plan: { recipes, machinesByBuilding, resourceDemand } };
}
