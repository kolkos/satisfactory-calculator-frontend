import { greaterEq, solve as solveLp } from 'yalps';
import type { Dataset } from '../dataset/parse-dataset';

/** A Part together with the Rate the player wants of it. */
export interface Target {
  readonly part: string;
  readonly rate: number;
}

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

/** Simplex leaves float dust on numbers that are exact in the problem. */
function tidy(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

export function solve(dataset: Dataset, targets: readonly Target[]): SolveResult {
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
  for (const recipe of dataset.recipes) {
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
      [SCARCITY_COST]: resource.weight,
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

  const recipesById = new Map(dataset.recipes.map((recipe) => [recipe.id, recipe]));
  const recipes: PlannedRecipe[] = [];
  const machinesByBuilding: Record<string, number> = {};
  const resourceDemand: Record<string, number> = {};

  for (const [key, rawValue] of solution.variables) {
    const value = tidy(rawValue);
    if (value === 0) continue;

    if (key.startsWith(RECIPE)) {
      const recipe = recipesById.get(key.slice(RECIPE.length));
      if (recipe === undefined) continue;
      recipes.push({ recipe: recipe.id, building: recipe.building, machines: value });
      machinesByBuilding[recipe.building] = tidy(
        (machinesByBuilding[recipe.building] ?? 0) + value,
      );
    } else if (key.startsWith(SUPPLY)) {
      resourceDemand[key.slice(SUPPLY.length)] = value;
    }
  }

  return { status: 'optimal', plan: { recipes, machinesByBuilding, resourceDemand } };
}
