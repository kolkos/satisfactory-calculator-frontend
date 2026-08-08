/**
 * Whether a Part is solid, fluid or gas. A closed set of three rather than a
 * solid/not-solid flag, because nitrogen gas is neither.
 */
export type PartState = 'solid' | 'fluid' | 'gas';

const PART_STATES: readonly PartState[] = ['solid', 'fluid', 'gas'];

/** Anything that flows through a production chain, whatever its Part State. */
export interface Part {
  readonly id: string;
  readonly name: string;
  readonly state: PartState;
}

/** One side of a Recipe: a Part moving at a Rate, always per minute. */
export interface RecipeFlow {
  readonly part: string;
  readonly rate: number;
}

/** A conversion of input Parts into output Parts in a specific building type. */
export interface Recipe {
  readonly id: string;
  readonly name: string;
  readonly building: string;
  readonly alternate: boolean;
  readonly inputs: readonly RecipeFlow[];
  readonly outputs: readonly RecipeFlow[];
}

/** A Part with no Recipe, extracted from the map. */
export interface Resource {
  readonly part: string;
  readonly weight: number;
  readonly extractorRate: number;
}

export interface Dataset {
  readonly gameVersion: string;
  readonly parts: readonly Part[];
  readonly recipes: readonly Recipe[];
  readonly resources: readonly Resource[];
}

/**
 * Thrown when the dataset asset does not match what the app expects. Carries the
 * path of the offending field so regenerating the dataset is not guesswork.
 */
export class DatasetValidationError extends Error {
  constructor(
    readonly path: string,
    readonly detail: string,
  ) {
    super(`${path}: ${detail}`);
    this.name = 'DatasetValidationError';
  }
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DatasetValidationError(path, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new DatasetValidationError(path, 'expected an array');
  }
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DatasetValidationError(path, 'expected a non-empty string');
  }
  return value;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new DatasetValidationError(path, 'expected a boolean');
  }
  return value;
}

type NumberBound = 'positive' | 'non-negative';

function asNumber(value: unknown, path: string, bound: NumberBound): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DatasetValidationError(path, 'expected a finite number');
  }
  if (bound === 'positive' && value <= 0) {
    throw new DatasetValidationError(path, 'expected a number greater than zero');
  }
  if (bound === 'non-negative' && value < 0) {
    throw new DatasetValidationError(path, 'expected a number of zero or more');
  }
  return value;
}

function asPartState(value: unknown, path: string): PartState {
  if (!PART_STATES.includes(value as PartState)) {
    throw new DatasetValidationError(path, `expected one of ${PART_STATES.join(', ')}`);
  }
  return value as PartState;
}

function parsePart(value: unknown, path: string): Part {
  const raw = asRecord(value, path);
  return {
    id: asString(raw['id'], `${path}.id`),
    name: asString(raw['name'], `${path}.name`),
    state: asPartState(raw['state'], `${path}.state`),
  };
}

function asKnownPart(value: unknown, path: string, knownParts: ReadonlySet<string>): string {
  const id = asString(value, path);
  if (!knownParts.has(id)) {
    throw new DatasetValidationError(path, `references unknown Part "${id}"`);
  }
  return id;
}

function parseFlow(value: unknown, path: string, knownParts: ReadonlySet<string>): RecipeFlow {
  const raw = asRecord(value, path);
  return {
    part: asKnownPart(raw['part'], `${path}.part`, knownParts),
    rate: asNumber(raw['rate'], `${path}.rate`, 'positive'),
  };
}

function parseRecipe(value: unknown, path: string, knownParts: ReadonlySet<string>): Recipe {
  const raw = asRecord(value, path);
  return {
    id: asString(raw['id'], `${path}.id`),
    name: asString(raw['name'], `${path}.name`),
    building: asString(raw['building'], `${path}.building`),
    alternate: asBoolean(raw['alternate'], `${path}.alternate`),
    inputs: asArray(raw['inputs'], `${path}.inputs`).map((flow, i) =>
      parseFlow(flow, `${path}.inputs[${i}]`, knownParts),
    ),
    outputs: asArray(raw['outputs'], `${path}.outputs`).map((flow, i) =>
      parseFlow(flow, `${path}.outputs[${i}]`, knownParts),
    ),
  };
}

function parseResource(value: unknown, path: string, knownParts: ReadonlySet<string>): Resource {
  const raw = asRecord(value, path);
  return {
    part: asKnownPart(raw['part'], `${path}.part`, knownParts),
    // Zero is deliberate, not an oversight: unbounded Resources such as water have
    // no node limit, so their Resource Weight really is zero. Extraction still costs
    // machines, which is what stops the optimiser squandering them.
    weight: asNumber(raw['weight'], `${path}.weight`, 'non-negative'),
    extractorRate: asNumber(raw['extractorRate'], `${path}.extractorRate`, 'positive'),
  };
}

/**
 * Turns untrusted JSON into a Dataset, or throws naming the field that failed.
 *
 * The dataset arrives over the wire rather than through a typed import, so its
 * shape is checked here rather than assumed.
 */
export function parseDataset(input: unknown): Dataset {
  const raw = asRecord(input, 'dataset');
  const gameVersion = asString(raw['gameVersion'], 'gameVersion');
  const parts = asArray(raw['parts'], 'parts').map((part, i) => parsePart(part, `parts[${i}]`));

  // Parts are parsed first so everything referencing them can be checked against
  // real ids rather than trusted. Duplicates are rejected rather than deduplicated:
  // a Set would silently keep one definition and discard the other, leaving every
  // downstream id lookup last-wins on data that is quietly wrong.
  const knownParts = new Set<string>();
  parts.forEach((part, i) => {
    if (knownParts.has(part.id)) {
      throw new DatasetValidationError(`parts[${i}].id`, `duplicate Part id "${part.id}"`);
    }
    knownParts.add(part.id);
  });

  return {
    gameVersion,
    parts,
    recipes: asArray(raw['recipes'], 'recipes').map((recipe, i) =>
      parseRecipe(recipe, `recipes[${i}]`, knownParts),
    ),
    resources: asArray(raw['resources'], 'resources').map((resource, i) =>
      parseResource(resource, `resources[${i}]`, knownParts),
    ),
  };
}