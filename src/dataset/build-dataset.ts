import type {
  Dataset,
  DatasetSource,
  Extractor,
  ExtractorTier,
  Part,
  PartState,
  Recipe,
  Resource,
} from './parse-dataset';

/**
 * The shape the Satisfactory wiki publishes its Docs templates in. Every entry is
 * keyed to a one-element array; only the fields the planner needs are declared.
 */
export interface WikiItem {
  readonly className: string;
  readonly name: string;
  readonly form: 'solid' | 'liquid' | 'gas';
}

export interface WikiFlow {
  readonly item: string;
  readonly amount: number;
}

export interface WikiRecipe {
  readonly className: string;
  readonly name: string;
  readonly duration: number;
  readonly ingredients: readonly WikiFlow[];
  readonly products: readonly WikiFlow[];
  readonly producedIn: readonly string[];
  readonly inBuildGun: boolean;
  readonly inCustomizer: boolean;
  readonly alternate: boolean;
}

export interface WikiBuilding {
  readonly className: string;
  readonly name: string;
}

export interface WikiDocs {
  readonly items: Readonly<Record<string, readonly WikiItem[]>>;
  readonly recipes: Readonly<Record<string, readonly WikiRecipe[]>>;
  readonly buildings: Readonly<Record<string, readonly WikiBuilding[]>>;
}

/**
 * Nodes of one purity mix extracted by one kind of machine. `normalRate` is that
 * machine's rate on a normal node at 100% clock speed — impure nodes yield half
 * and pure nodes double. `tiered` marks the ones a Miner works, which are the only
 * ones whose yield rises with the Extractor Tier.
 */
interface NodeGroup {
  readonly impure: number;
  readonly normal: number;
  readonly pure: number;
  readonly normalRate: number;
  readonly tiered?: boolean;
}

/** Miner Mk.1, Mk.2 and Mk.3 relative to Mk.1. */
const TIER_FACTOR: Readonly<Record<ExtractorTier, number>> = { 1: 1, 2: 2, 3: 4 };

const MINERS: readonly Extractor[] = [
  { building: 'Miner Mk.1', rate: 60 },
  { building: 'Miner Mk.2', rate: 120 },
  { building: 'Miner Mk.3', rate: 240 },
];

export interface ResourceSpec {
  readonly part: string;
  /** One entry, or one per Extractor Tier where the machine has generations. */
  readonly extractors: readonly Extractor[];
  readonly groups: readonly NodeGroup[];
  /**
   * The maximum per minute the wiki publishes for this Resource. It assumes the
   * best machine at 250% clock, so it equals this Resource's tier-3 availability
   * times 2.5 — an identity that checks the transcribed node counts and the tier
   * factors at once, against a figure the wiki derived separately.
   */
  readonly publishedMax: number;
  /**
   * Water alone has no node limit: extractors need no node and any lake will do,
   * so its Resource Weight is zero.
   *
   * Nothing yet stops the optimiser exploiting that. ADR-0001 calls for extraction
   * to be modelled as a machine-costed Recipe and for a second, machine-minimising
   * optimisation phase, which is where the cost of pumping absurd volumes would
   * come from. Neither exists yet, so until then water is genuinely free.
   */
  readonly unbounded?: boolean;
}

const MINER_MK1 = 60;
const OIL_EXTRACTOR = 120;
const WATER_EXTRACTOR = 120;
const WELL_EXTRACTOR = 60;

/**
 * Node counts transcribed from the Satisfactory wiki's Resource Node and Resource
 * Well pages. Neither the game's own Docs nor the wiki's Docs templates carry map
 * data, so this is a separate, hand-entered source — see ADR-0001.
 */
const RESOURCE_SPECS: readonly ResourceSpec[] = [
  {
    part: 'Desc_OreIron_C',
    extractors: MINERS,
    publishedMax: 92100,
    groups: [{ impure: 39, normal: 42, pure: 46, normalRate: MINER_MK1, tiered: true }],
  },
  {
    part: 'Desc_OreCopper_C',
    extractors: MINERS,
    publishedMax: 36900,
    groups: [{ impure: 13, normal: 29, pure: 13, normalRate: MINER_MK1, tiered: true }],
  },
  {
    part: 'Desc_Stone_C',
    extractors: MINERS,
    publishedMax: 69300,
    groups: [{ impure: 15, normal: 50, pure: 29, normalRate: MINER_MK1, tiered: true }],
  },
  {
    part: 'Desc_Coal_C',
    extractors: MINERS,
    publishedMax: 42300,
    groups: [{ impure: 15, normal: 31, pure: 16, normalRate: MINER_MK1, tiered: true }],
  },
  {
    part: 'Desc_OreGold_C',
    extractors: MINERS,
    publishedMax: 15000,
    groups: [{ impure: 0, normal: 9, pure: 8, normalRate: MINER_MK1, tiered: true }],
  },
  {
    part: 'Desc_RawQuartz_C',
    extractors: MINERS,
    publishedMax: 13500,
    groups: [{ impure: 3, normal: 7, pure: 7, normalRate: MINER_MK1, tiered: true }],
  },
  {
    part: 'Desc_Sulfur_C',
    extractors: MINERS,
    publishedMax: 10800,
    groups: [{ impure: 6, normal: 5, pure: 5, normalRate: MINER_MK1, tiered: true }],
  },
  {
    part: 'Desc_OreBauxite_C',
    extractors: MINERS,
    publishedMax: 12300,
    groups: [{ impure: 5, normal: 6, pure: 6, normalRate: MINER_MK1, tiered: true }],
  },
  {
    part: 'Desc_OreUranium_C',
    extractors: MINERS,
    publishedMax: 2100,
    groups: [{ impure: 3, normal: 2, pure: 0, normalRate: MINER_MK1, tiered: true }],
  },
  {
    part: 'Desc_SAM_C',
    extractors: MINERS,
    publishedMax: 10200,
    groups: [{ impure: 10, normal: 6, pure: 3, normalRate: MINER_MK1, tiered: true }],
  },
  // Crude Oil comes from both ordinary nodes and resource wells. The Oil Extractor
  // is quoted as the nominal machine, since it works the larger share.
  {
    part: 'Desc_LiquidOil_C',
    extractors: [{ building: 'Oil Extractor', rate: OIL_EXTRACTOR }],
    publishedMax: 12600,
    groups: [
      { impure: 10, normal: 12, pure: 8, normalRate: OIL_EXTRACTOR },
      { impure: 8, normal: 6, pure: 4, normalRate: WELL_EXTRACTOR },
    ],
  },
  {
    part: 'Desc_NitrogenGas_C',
    extractors: [{ building: 'Resource Well Extractor', rate: WELL_EXTRACTOR }],
    publishedMax: 12000,
    groups: [{ impure: 2, normal: 7, pure: 36, normalRate: WELL_EXTRACTOR }],
  },
  {
    part: 'Desc_Water_C',
    extractors: [{ building: 'Water Extractor', rate: WATER_EXTRACTOR }],
    publishedMax: 13125,
    unbounded: true,
    groups: [{ impure: 7, normal: 12, pure: 36, normalRate: WELL_EXTRACTOR }],
  },
];

/** What the whole map yields per minute at a given tier, at 100% clock speed. */
export function totalAvailable(spec: ResourceSpec, tier: ExtractorTier): number {
  return spec.groups.reduce((total, g) => {
    const scale = g.tiered === true ? TIER_FACTOR[tier] : 1;
    return total + (g.impure * 0.5 + g.normal + g.pure * 2) * g.normalRate * scale;
  }, 0);
}

export const RESOURCES: readonly ResourceSpec[] = RESOURCE_SPECS;

function toResource(spec: ResourceSpec): Resource {
  return {
    part: spec.part,
    unbounded: spec.unbounded === true,
    // Unbounded Resources state no availability rather than a zero, which would
    // read as "none of it" instead of "no limit".
    availableByTier:
      spec.unbounded === true
        ? []
        : spec.extractors.map((_, i) => totalAvailable(spec, (i + 1) as ExtractorTier)),
    extractors: spec.extractors,
  };
}

const STATES: Readonly<Record<WikiItem['form'], PartState>> = {
  solid: 'solid',
  liquid: 'fluid',
  gas: 'gas',
};

/** Rates are per minute; the source gives an amount per craft and a craft duration. */
function toRate(amount: number, duration: number): number {
  return (amount * 60) / duration;
}

function only<T>(entries: readonly T[] | undefined): T | undefined {
  return entries?.[0];
}

/** Thrown when upstream no longer matches what this transformation assumes. */
export class DatasetBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetBuildError';
  }
}

export function buildDataset(
  docs: WikiDocs,
  source: DatasetSource,
  specs: readonly ResourceSpec[] = RESOURCES,
): Dataset {
  const recipes: Recipe[] = [];
  const referenced = new Set<string>();
  const unknownBuildings = new Set<string>();

  for (const entry of Object.values(docs.recipes)) {
    const raw = only(entry);
    if (raw === undefined) continue;

    // The build gun and the customizer are not production, and a recipe with no
    // machine can only be hand-crafted — none of them can appear in a Plan.
    if (raw.inBuildGun || raw.inCustomizer) continue;
    const buildingClass = only(raw.producedIn);
    if (buildingClass === undefined) continue;

    // Upstream is a wiki that changes under us. A renamed building class would
    // otherwise drop every Recipe made in it, leaving a dataset that validates
    // cleanly and is quietly missing a whole production step.
    const building = only(docs.buildings[buildingClass]);
    if (building === undefined) {
      unknownBuildings.add(buildingClass);
      continue;
    }

    const flows = (list: readonly WikiFlow[]) =>
      list.map((flow) => {
        referenced.add(flow.item);
        return { part: flow.item, rate: toRate(flow.amount, raw.duration) };
      });

    recipes.push({
      id: raw.className,
      name: raw.name,
      building: building.name,
      alternate: raw.alternate,
      inputs: flows(raw.ingredients),
      outputs: flows(raw.products),
    });
  }

  if (unknownBuildings.size > 0) {
    throw new DatasetBuildError(
      `producedIn names buildings absent from the buildings template: ${[...unknownBuildings].sort().join(', ')}`,
    );
  }

  // The Resource class names are hand-transcribed from the wiki's Resource Node
  // pages — a different source from the items template — so they can drift apart.
  // Silently dropping one would make every chain needing it infeasible, with the
  // dataset still passing validation and nothing to point at.
  const missing = specs.filter((spec) => docs.items[spec.part] === undefined);
  if (missing.length > 0) {
    throw new DatasetBuildError(
      `Resources absent from the items template: ${missing.map((spec) => spec.part).join(', ')}`,
    );
  }

  const resources = specs.map(toResource);
  for (const resource of resources) referenced.add(resource.part);

  // Only Parts something actually moves. The source lists equipment, ammo and
  // collectibles that no machine recipe touches, and they would be dead rows in
  // every model the optimiser builds.
  const parts: Part[] = [];
  for (const entry of Object.values(docs.items)) {
    const item = only(entry);
    if (item === undefined || !referenced.has(item.className)) continue;
    parts.push({ id: item.className, name: item.name, state: STATES[item.form] });
  }

  return { source, parts, recipes, resources };
}
