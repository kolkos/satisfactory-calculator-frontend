import { greaterEq, solve as solveLp } from 'yalps';
import { resourceWeight, type Dataset, type ExtractorTier } from '../dataset/parse-dataset';

/**
 * The Extractor Tier every Plan is currently priced at.
 *
 * TODO(#7): take this from the Plan Request. ADR-0006 specifies a Mk.3 default,
 * so this is not that — Mk.1 is here only so the move to per-tier availability
 * could be shown to change no answers. Until the Request is plumbed through, the
 * documented default and the shipped behaviour differ.
 */
const PRICED_AT_TIER: ExtractorTier = 1;

/** A Part together with the Rate the player wants of it. */
export interface Target {
  readonly part: string;
  readonly rate: number;
}

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

/** Objective row. Internal to the solver; never surfaces in a Plan. */
const SCARCITY_COST = 'scarcityCost';

const RECIPE = 'recipe:';
const SUPPLY = 'supply:';

/** The precision YALPS rounds its own variables to, so sums cannot beat it. */
const SOLVER_PRECISION = 1e8;

/**
 * Rounds a machine count accumulated across Recipes. Individual variables arrive
 * already rounded by the solver, but adding two rounded values makes fresh dust —
 * 0.1 + 0.2 is 0.30000000000000004 — and the sum is the number a player sees.
 */
function roundLikeSolver(value: number): number {
  return Math.round(value * SOLVER_PRECISION) / SOLVER_PRECISION;
}

export function solve(
  dataset: Dataset,
  targets: readonly Target[],
  profile: UnlockProfile = NO_UNLOCKS,
): SolveResult {
  // An Alternate the player has not researched is not a Recipe they can build, so
  // it never becomes a variable. Filtering here rather than penalising it in the
  // objective keeps "cannot build" and "not worth building" separate.
  const admissible = dataset.recipes.filter(
    (recipe) => !recipe.alternate || profile.has(recipe.id),
  );

  const demanded = new Map<string, number>();
  for (const target of targets) {
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

  // A Recipe variable counts machines, so its coefficient in a Part's row is that
  // Part's net rate through one machine.
  for (const recipe of admissible) {
    const column: Record<string, number> = { [SCARCITY_COST]: 0 };
    for (const input of recipe.inputs) {
      column[input.part] = (column[input.part] ?? 0) - input.rate;
    }
    for (const output of recipe.outputs) {
      column[output.part] = (column[output.part] ?? 0) + output.rate;
    }
    variables[`${RECIPE}${recipe.id}`] = column;
  }

  // A Resource enters the chain through a supply variable priced at its Resource
  // Weight. Keeping it a variable rather than an exemption is what stops Resources
  // becoming a special case in the rows above.
  for (const resource of dataset.resources) {
    variables[`${SUPPLY}${resource.part}`] = {
      [resource.part]: 1,
      [SCARCITY_COST]: resourceWeight(resource, PRICED_AT_TIER),
    };
  }

  const solution = solveLp({
    direction: 'minimize',
    objective: SCARCITY_COST,
    constraints,
    variables,
  });

  if (solution.status === 'infeasible') {
    return { status: 'infeasible', reason: 'no combination of Recipes meets the Targets' };
  }
  if (solution.status !== 'optimal') {
    // "unbounded", "timedout" and "cycled" are the solver failing, not a proof
    // that the Targets cannot be built.
    return { status: 'failed', reason: `solver returned "${solution.status}"` };
  }

  const recipesById = new Map(admissible.map((recipe) => [recipe.id, recipe]));
  const recipes: PlannedRecipe[] = [];
  const machinesByBuilding: Record<string, number> = {};
  const resourceDemand: Record<string, number> = {};

  // Per-variable values arrive already rounded by the solver, so they are taken as
  // they come. Only the accumulated machine counts are rounded again, because
  // adding rounded values is what reintroduces dust.
  for (const [key, value] of solution.variables) {
    if (value === 0) continue;

    if (key.startsWith(RECIPE)) {
      const recipe = recipesById.get(key.slice(RECIPE.length));
      if (recipe === undefined) continue;
      recipes.push({ recipe: recipe.id, building: recipe.building, machines: value });
      machinesByBuilding[recipe.building] = roundLikeSolver(
        (machinesByBuilding[recipe.building] ?? 0) + value,
      );
    } else if (key.startsWith(SUPPLY)) {
      resourceDemand[key.slice(SUPPLY.length)] = value;
    }
  }

  return { status: 'optimal', plan: { recipes, machinesByBuilding, resourceDemand } };
}
