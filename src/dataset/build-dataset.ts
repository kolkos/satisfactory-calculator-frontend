import type { Dataset, DatasetSource, Part, PartState, Recipe, Resource } from './parse-dataset';

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
 * and pure nodes double.
 */
interface NodeGroup {
  readonly impure: number;
  readonly normal: number;
  readonly pure: number;
  readonly normalRate: number;
}

export interface ResourceSpec {
  readonly part: string;
  /** One extractor's nominal output, as the game's own building description states it. */
  readonly extractorRate: number;
  readonly groups: readonly NodeGroup[];
  /**
   * The maximum per minute the wiki publishes for this Resource, together with
   * what it assumes over an unclocked figure — ×2.5 for overclocking alone, ×10
   * where a Miner Mk.3 is assumed as well. Carried purely so the arithmetic here
   * can be checked against the source it was transcribed from.
   */
  readonly publishedMax: number;
  readonly publishedMaxFactor: number;
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
    extractorRate: MINER_MK1,
    publishedMax: 92100,
    publishedMaxFactor: 10,
    groups: [{ impure: 39, normal: 42, pure: 46, normalRate: MINER_MK1 }],
  },
  {
    part: 'Desc_OreCopper_C',
    extractorRate: MINER_MK1,
    publishedMax: 36900,
    publishedMaxFactor: 10,
    groups: [{ impure: 13, normal: 29, pure: 13, normalRate: MINER_MK1 }],
  },
  {
    part: 'Desc_Stone_C',
    extractorRate: MINER_MK1,
    publishedMax: 69300,
    publishedMaxFactor: 10,
    groups: [{ impure: 15, normal: 50, pure: 29, normalRate: MINER_MK1 }],
  },
  {
    part: 'Desc_Coal_C',
    extractorRate: MINER_MK1,
    publishedMax: 42300,
    publishedMaxFactor: 10,
    groups: [{ impure: 15, normal: 31, pure: 16, normalRate: MINER_MK1 }],
  },
  {
    part: 'Desc_OreGold_C',
    extractorRate: MINER_MK1,
    publishedMax: 15000,
    publishedMaxFactor: 10,
    groups: [{ impure: 0, normal: 9, pure: 8, normalRate: MINER_MK1 }],
  },
  {
    part: 'Desc_RawQuartz_C',
    extractorRate: MINER_MK1,
    publishedMax: 13500,
    publishedMaxFactor: 10,
    groups: [{ impure: 3, normal: 7, pure: 7, normalRate: MINER_MK1 }],
  },
  {
    part: 'Desc_Sulfur_C',
    extractorRate: MINER_MK1,
    publishedMax: 10800,
    publishedMaxFactor: 10,
    groups: [{ impure: 6, normal: 5, pure: 5, normalRate: MINER_MK1 }],
  },
  {
    part: 'Desc_OreBauxite_C',
    extractorRate: MINER_MK1,
    publishedMax: 12300,
    publishedMaxFactor: 10,
    groups: [{ impure: 5, normal: 6, pure: 6, normalRate: MINER_MK1 }],
  },
  {
    part: 'Desc_OreUranium_C',
    extractorRate: MINER_MK1,
    publishedMax: 2100,
    publishedMaxFactor: 10,
    groups: [{ impure: 3, normal: 2, pure: 0, normalRate: MINER_MK1 }],
  },
  {
    part: 'Desc_SAM_C',
    extractorRate: MINER_MK1,
    publishedMax: 10200,
    publishedMaxFactor: 10,
    groups: [{ impure: 10, normal: 6, pure: 3, normalRate: MINER_MK1 }],
  },
  // Crude Oil comes from both ordinary nodes and resource wells.
  {
    part: 'Desc_LiquidOil_C',
    extractorRate: OIL_EXTRACTOR,
    publishedMax: 12600,
    publishedMaxFactor: 2.5,
    groups: [
      { impure: 10, normal: 12, pure: 8, normalRate: OIL_EXTRACTOR },
      { impure: 8, normal: 6, pure: 4, normalRate: WELL_EXTRACTOR },
    ],
  },
  {
    part: 'Desc_NitrogenGas_C',
    extractorRate: WELL_EXTRACTOR,
    publishedMax: 12000,
    publishedMaxFactor: 2.5,
    groups: [{ impure: 2, normal: 7, pure: 36, normalRate: WELL_EXTRACTOR }],
  },
  {
    part: 'Desc_Water_C',
    extractorRate: WATER_EXTRACTOR,
    publishedMax: 13125,
    publishedMaxFactor: 2.5,
    unbounded: true,
    groups: [{ impure: 7, normal: 12, pure: 36, normalRate: WELL_EXTRACTOR }],
  },
];

/** What the whole map yields per minute, at 100% clock speed and no miner upgrades. */
export function totalAvailable(spec: ResourceSpec): number {
  return spec.groups.reduce(
    (total, g) => total + (g.impure * 0.5 + g.normal + g.pure * 2) * g.normalRate,
    0,
  );
}

export const RESOURCES: readonly ResourceSpec[] = RESOURCE_SPECS;

function toResource(spec: ResourceSpec): Resource {
  return {
    part: spec.part,
    weight: spec.unbounded === true ? 0 : 1 / totalAvailable(spec),
    extractorRate: spec.extractorRate,
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
