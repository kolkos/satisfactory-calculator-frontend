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

/** Which generation of mining machine a Plan assumes. */
export type ExtractorTier = 1 | 2 | 3;

/** One generation of extractor, and what it yields on a normal node unclocked. */
export interface Extractor {
  readonly building: string;
  readonly rate: number;
}

/**
 * A Part with no Recipe, extracted from the map.
 *
 * Carries what the map holds rather than a scarcity price, because the price
 * depends on the Extractor Tier a Plan was asked about — see ADR-0006. Mined
 * Resources have three entries; a single entry means the tier does not apply,
 * which is true of every fluid extractor.
 */
export interface Resource {
  readonly part: string;
  readonly unbounded: boolean;
  /** Map yield per minute at each Extractor Tier. Empty when unbounded. */
  readonly availableByTier: readonly number[];
  readonly extractors: readonly Extractor[];
}

function tierIndex(resource: Resource, tier: ExtractorTier): number {
  // A Resource whose extractor has no generations answers every tier the same.
  return resource.extractors.length === 1 ? 0 : tier - 1;
}

/**
 * The scarcity price of one unit per minute of this Resource at a given tier:
 * one over what the whole map yields. Zero where the map imposes no limit.
 *
 * Throws rather than returning a status, unlike everything in the solver: the
 * boundary has already rejected any Resource whose entries do not line up, so
 * reaching this is a caller passing a hand-built Dataset that never could have
 * been loaded. That is a defect to surface, not a Plan that cannot be built.
 */
export function resourceWeight(resource: Resource, tier: ExtractorTier): number {
  if (resource.unbounded) return 0;
  const available = resource.availableByTier[tierIndex(resource, tier)];
  if (available === undefined) {
    throw new Error(`no availability for ${resource.part} at tier ${tier}`);
  }
  return 1 / available;
}

/** The extractor a Plan at this tier would build, and its nominal rate. */
export function extractorFor(resource: Resource, tier: ExtractorTier): Extractor {
  const extractor = resource.extractors[tierIndex(resource, tier)];
  if (extractor === undefined) {
    throw new Error(`no extractor for ${resource.part} at tier ${tier}`);
  }
  return extractor;
}

/**
 * Where this Dataset came from. Not a game version — the upstream source is a
 * wiki that publishes no version number — but its page revisions are stable and
 * citable, so they serve the same purpose: two Datasets with the same revisions
 * were built from the same bytes.
 */
export interface DatasetSource {
  readonly url: string;
  readonly fetchedAt: string;
  readonly revisions: Readonly<Record<string, number>>;
}

export interface Dataset {
  readonly source: DatasetSource;
  readonly parts: readonly Part[];
  readonly recipes: readonly Recipe[];
  readonly resources: readonly Resource[];
}

/**
 * Thrown when the dataset asset does not match what the app expects. Carries the
 * path of the offending field so regenerating the dataset is not guesswork.
 */
export class DatasetValidationError extends Error {
  // Declared as fields rather than constructor parameter properties so this
  // module can be run directly by the generation script, which strips types
  // without transforming them.
  readonly path: string;
  readonly detail: string;

  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = 'DatasetValidationError';
    this.path = path;
    this.detail = detail;
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

function parseExtractor(value: unknown, path: string): Extractor {
  const raw = asRecord(value, path);
  return {
    building: asString(raw['building'], `${path}.building`),
    rate: asNumber(raw['rate'], `${path}.rate`, 'positive'),
  };
}

function parseResource(value: unknown, path: string, knownParts: ReadonlySet<string>): Resource {
  const raw = asRecord(value, path);
  const part = asKnownPart(raw['part'], `${path}.part`, knownParts);
  const unbounded = asBoolean(raw['unbounded'], `${path}.unbounded`);

  const extractors = asArray(raw['extractors'], `${path}.extractors`).map((extractor, i) =>
    parseExtractor(extractor, `${path}.extractors[${i}]`),
  );
  // One generation or three: anything else means the source grew a tier we do not
  // model, and guessing which entry to price a Plan from would be worse than failing.
  if (extractors.length !== 1 && extractors.length !== 3) {
    throw new DatasetValidationError(
      `${path}.extractors`,
      `expected 1 or 3 entries, found ${extractors.length}`,
    );
  }

  const availableByTier = asArray(raw['availableByTier'], `${path}.availableByTier`).map(
    (available, i) => asNumber(available, `${path}.availableByTier[${i}]`, 'positive'),
  );
  // Unbounded Resources state no availability at all, rather than a zero that
  // would read as "none available" instead of "no limit".
  const expected = unbounded ? 0 : extractors.length;
  if (availableByTier.length !== expected) {
    throw new DatasetValidationError(
      `${path}.availableByTier`,
      `expected ${expected} entries for ${unbounded ? 'an unbounded' : 'this'} Resource, found ${availableByTier.length}`,
    );
  }

  return { part, unbounded, availableByTier, extractors };
}

function parseSource(value: unknown, path: string): DatasetSource {
  const raw = asRecord(value, path);
  const revisions = asRecord(raw['revisions'], `${path}.revisions`);
  const parsed: Record<string, number> = {};
  for (const [page, revision] of Object.entries(revisions)) {
    parsed[page] = asNumber(revision, `${path}.revisions.${page}`, 'positive');
  }
  return {
    url: asString(raw['url'], `${path}.url`),
    fetchedAt: asString(raw['fetchedAt'], `${path}.fetchedAt`),
    revisions: parsed,
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
  const source = parseSource(raw['source'], 'source');
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
    source,
    parts,
    recipes: parseRecipes(raw['recipes'], knownParts),
    resources: parseResources(raw['resources'], knownParts),
  };
}

/**
 * A Recipe id is what an Unlock Profile names to admit an Alternate, so a
 * duplicate would make unlocking one Recipe silently enable or drop another.
 */
function parseRecipes(value: unknown, knownParts: ReadonlySet<string>): readonly Recipe[] {
  const seen = new Set<string>();
  return asArray(value, 'recipes').map((raw, i) => {
    const recipe = parseRecipe(raw, `recipes[${i}]`, knownParts);
    if (seen.has(recipe.id)) {
      throw new DatasetValidationError(`recipes[${i}].id`, `duplicate Recipe id "${recipe.id}"`);
    }
    seen.add(recipe.id);
    return recipe;
  });
}

/**
 * Resources are keyed by Part downstream, so two rows for one Part would be
 * last-wins on a Resource Weight — the same silent corruption duplicate Part ids
 * are rejected for.
 */
function parseResources(value: unknown, knownParts: ReadonlySet<string>): readonly Resource[] {
  const seen = new Set<string>();
  return asArray(value, 'resources').map((raw, i) => {
    const resource = parseResource(raw, `resources[${i}]`, knownParts);
    if (seen.has(resource.part)) {
      throw new DatasetValidationError(
        `resources[${i}].part`,
        `duplicate Resource row for Part "${resource.part}"`,
      );
    }
    seen.add(resource.part);
    return resource;
  });
}
