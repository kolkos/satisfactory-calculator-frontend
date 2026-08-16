import { describe, expect, it } from 'vitest';
import type { Dataset, ExtractorTier } from '../dataset/parse-dataset';
import { solve, type Plan, type PlanRequest, type Target, type UnlockProfile } from './solve';

/** Builds a Plan Request so each test states only what it cares about. */
function plan(
  dataset: Dataset,
  targets: readonly Target[],
  profile?: UnlockProfile,
  extractorTier?: ExtractorTier,
) {
  const request: PlanRequest = { targets, extractorTier };
  return solve(dataset, request, profile);
}

const TEST_SOURCE = { url: 'test', fetchedAt: '2026-01-01T00:00:00Z', revisions: {} };

/** Machine counts for the factory itself, leaving extraction aside. */
function factory(built: Plan): Record<string, number> {
  const counts = { ...built.machinesByBuilding };
  delete counts['Extractor'];
  return counts;
}

/** A Resource priced at a given weight: availability is one over it. */
function resource(part: string, weight: number, rate: number) {
  return {
    part,
    unbounded: weight === 0,
    availableByTier: weight === 0 ? [] : [1 / weight],
    extractors: [{ building: 'Extractor', rate }],
  };
}

/**
 * Iron Ore is smelted into Iron Ingot one for one, 30/min per Smelter.
 * Small enough that every expected number below can be worked out on paper.
 */
function ingotDataset(): Dataset {
  return {
    source: TEST_SOURCE,
    parts: [
      { id: 'IronOre', name: 'Iron Ore', state: 'solid' },
      { id: 'IronIngot', name: 'Iron Ingot', state: 'solid' },
    ],
    recipes: [
      {
        id: 'IronIngot',
        name: 'Iron Ingot',
        building: 'Smelter',
        alternate: false,
        inputs: [{ part: 'IronOre', rate: 30 }],
        outputs: [{ part: 'IronIngot', rate: 30 }],
      },
    ],
    resources: [resource('IronOre', 0.0001, 60)],
  };
}

/** Ore -> Ingot (Smelter, 30 -> 30) -> Plate (Constructor, 30 -> 20). */
function chainDataset(): Dataset {
  const base = ingotDataset();
  return {
    ...base,
    parts: [...base.parts, { id: 'IronPlate', name: 'Iron Plate', state: 'solid' }],
    recipes: [
      ...base.recipes,
      {
        id: 'IronPlate',
        name: 'Iron Plate',
        building: 'Constructor',
        alternate: false,
        inputs: [{ part: 'IronIngot', rate: 30 }],
        outputs: [{ part: 'IronPlate', rate: 20 }],
      },
    ],
  };
}

/**
 * Two default Recipes for one Widget. Through OreA it costs 10 units of a scarce
 * Resource; through OreB, 50 units of an abundant one. Weights are passed in so a
 * test can flip which Resource is scarce without touching anything else.
 */
function choiceDataset(weights: { oreA: number; oreB: number }): Dataset {
  return {
    source: TEST_SOURCE,
    parts: [
      { id: 'OreA', name: 'Ore A', state: 'solid' },
      { id: 'OreB', name: 'Ore B', state: 'solid' },
      { id: 'Widget', name: 'Widget', state: 'solid' },
    ],
    recipes: [
      {
        id: 'Widget_FromA',
        name: 'Widget from A',
        building: 'Constructor',
        alternate: false,
        inputs: [{ part: 'OreA', rate: 10 }],
        outputs: [{ part: 'Widget', rate: 10 }],
      },
      {
        id: 'Widget_FromB',
        name: 'Widget from B',
        building: 'Constructor',
        alternate: false,
        inputs: [{ part: 'OreB', rate: 50 }],
        outputs: [{ part: 'Widget', rate: 10 }],
      },
    ],
    resources: [resource('OreA', weights.oreA, 60), resource('OreB', weights.oreB, 60)],
  };
}

/**
 * One Widget, two ways: the default at 10 ore, and an Alternate at 4. The
 * Alternate is strictly better, so whether it is used says exactly one thing —
 * whether the Unlock Profile let it into the model.
 */
function alternateDataset(): Dataset {
  return {
    source: TEST_SOURCE,
    parts: [
      { id: 'OreA', name: 'Ore A', state: 'solid' },
      { id: 'Widget', name: 'Widget', state: 'solid' },
    ],
    recipes: [
      {
        id: 'Widget_Base',
        name: 'Widget',
        building: 'Constructor',
        alternate: false,
        inputs: [{ part: 'OreA', rate: 10 }],
        outputs: [{ part: 'Widget', rate: 10 }],
      },
      {
        id: 'Widget_Pure',
        name: 'Pure Widget',
        building: 'Refinery',
        alternate: true,
        inputs: [{ part: 'OreA', rate: 4 }],
        outputs: [{ part: 'Widget', rate: 10 }],
      },
    ],
    resources: [resource('OreA', 1, 60)],
  };
}

describe('solve', () => {
  it('resolves a single Target through one Recipe to one Resource', () => {
    const result = plan(ingotDataset(), [{ part: 'IronIngot', rate: 60 }]);

    // 60 ingots a minute needs two Smelters at 30 each, eating 60 ore a minute.
    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes).toEqual([
      { recipe: 'IronIngot', building: 'Smelter', machines: 2 },
    ]);
    expect(factory(result.plan)).toEqual({ Smelter: 2 });
    expect(result.plan.resourceDemand).toEqual({ IronOre: 60 });
  });

  it('walks a chain down to the Resource, grouping machines by building', () => {
    const result = plan(chainDataset(), [{ part: 'IronPlate', rate: 20 }]);

    // 20 plates needs 1 Constructor, which eats 30 ingots, which needs 1 Smelter,
    // which eats 30 ore.
    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(factory(result.plan)).toEqual({ Smelter: 1, Constructor: 1 });
    expect(result.plan.resourceDemand).toEqual({ IronOre: 30 });
  });

  it('satisfies several Targets in one call', () => {
    const result = plan(chainDataset(), [
      { part: 'IronPlate', rate: 20 },
      { part: 'IronIngot', rate: 30 },
    ]);

    // The plate line eats 30 ingots and 30 more are wanted outright, so 60 ingots
    // in total: 2 Smelters, 1 Constructor, 60 ore.
    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(factory(result.plan)).toEqual({ Smelter: 2, Constructor: 1 });
    expect(result.plan.resourceDemand).toEqual({ IronOre: 60 });
  });

  it('reports infeasible, not an empty Plan, when no chain reaches the Target', () => {
    const dataset = ingotDataset();
    const unreachable: Dataset = {
      ...dataset,
      parts: [...dataset.parts, { id: 'Screw', name: 'Screw', state: 'solid' }],
    };

    const result = plan(unreachable, [{ part: 'Screw', rate: 10 }]);

    expect(result.status).toBe('infeasible');
  });

  it('allows excess production, so an unwanted Byproduct cannot block a chain', () => {
    const dataset = ingotDataset();
    const withByproduct: Dataset = {
      ...dataset,
      parts: [...dataset.parts, { id: 'Slag', name: 'Slag', state: 'solid' }],
      recipes: [
        {
          ...dataset.recipes[0],
          outputs: [
            { part: 'IronIngot', rate: 30 },
            { part: 'Slag', rate: 10 },
          ],
        },
      ],
    };

    const result = plan(withByproduct, [{ part: 'IronIngot', rate: 30 }]);

    // Nothing consumes Slag. Under equality this would be infeasible; under the
    // inequality the Smelter simply runs and the Slag piles up.
    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(factory(result.plan)).toEqual({ Smelter: 1 });
  });

  it('returns fractional machine counts rather than rounding up', () => {
    const result = plan(ingotDataset(), [{ part: 'IronIngot', rate: 45 }]);

    // 45 a minute is one and a half Smelters: two machines, the last at 50%.
    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(factory(result.plan)).toEqual({ Smelter: 1.5 });
    expect(result.plan.resourceDemand).toEqual({ IronOre: 45 });
  });

  it('adds up several Targets naming the same Part', () => {
    const result = plan(ingotDataset(), [
      { part: 'IronIngot', rate: 30 },
      { part: 'IronIngot', rate: 30 },
    ]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(factory(result.plan)).toEqual({ Smelter: 2 });
  });

  it('answers a Target that is itself a Resource', () => {
    const result = plan(ingotDataset(), [{ part: 'IronOre', rate: 120 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes).toEqual([]);
    expect(result.plan.resourceDemand).toEqual({ IronOre: 120 });
  });

  it('names the Part when a Target is not in the Dataset', () => {
    const result = plan(ingotDataset(), [{ part: 'Concrete', rate: 10 }]);

    expect(result.status).toBe('infeasible');
    if (result.status !== 'infeasible') return;

    expect(result.reason).toMatch(/Concrete/);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['not a number', Number.NaN],
  ])('rejects a %s Target Rate rather than returning an empty Plan', (_label, rate) => {
    const result = plan(ingotDataset(), [{ part: 'IronIngot', rate }]);

    expect(result.status).toBe('infeasible');
    if (result.status !== 'infeasible') return;

    expect(result.reason).toMatch(/IronIngot/);
  });

  it('keeps Scarcity Cost out of the Plan', () => {
    const result = plan(ingotDataset(), [{ part: 'IronIngot', rate: 60 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(Object.keys(result.plan).sort()).toEqual([
      'machinesByBuilding',
      'recipes',
      'resourceDemand',
      'surplus',
    ]);
    expect(JSON.stringify(result.plan)).not.toMatch(/scarcity/i);
  });

  it('prefers the abundant Resource even though it spends five times the units', () => {
    // Through A: 10 units at weight 1 = 10. Through B: 50 units at weight 0.01 = 0.5.
    const result = plan(choiceDataset({ oreA: 1, oreB: 0.01 }), [{ part: 'Widget', rate: 10 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes.map((entry) => entry.recipe)).toEqual(['Widget_FromB']);
    expect(result.plan.resourceDemand).toEqual({ OreB: 50 });
  });

  it('follows the Resource Weights rather than the order Recipes appear in', () => {
    // Same Recipes, scarcity swapped: now A is the cheap route and B the expensive one.
    const result = plan(choiceDataset({ oreA: 0.01, oreB: 1 }), [{ part: 'Widget', rate: 10 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes.map((entry) => entry.recipe)).toEqual(['Widget_FromA']);
    expect(result.plan.resourceDemand).toEqual({ OreA: 10 });
  });

  it('never uses an Alternate the Unlock Profile does not hold', () => {
    const result = plan(alternateDataset(), [{ part: 'Widget', rate: 10 }], new Set());

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes.map((entry) => entry.recipe)).toEqual(['Widget_Base']);
    expect(result.plan.resourceDemand).toEqual({ OreA: 10 });
  });

  it('treats an empty Unlock Profile as the default, so the Profile is optional', () => {
    const withoutProfile = plan(alternateDataset(), [{ part: 'Widget', rate: 10 }]);
    const withEmptyProfile = plan(alternateDataset(), [{ part: 'Widget', rate: 10 }], new Set());

    expect(withoutProfile).toEqual(withEmptyProfile);
  });

  it('returns a different Plan once the Alternate is unlocked', () => {
    const locked = plan(alternateDataset(), [{ part: 'Widget', rate: 10 }], new Set());
    const unlocked = plan(
      alternateDataset(),
      [{ part: 'Widget', rate: 10 }],
      new Set(['Widget_Pure']),
    );

    expect(locked.status).toBe('optimal');
    expect(unlocked.status).toBe('optimal');
    if (locked.status !== 'optimal' || unlocked.status !== 'optimal') return;

    // Same question, same data — only the Profile differs, and 10 ore becomes 4.
    expect(locked.plan.resourceDemand).toEqual({ OreA: 10 });
    expect(unlocked.plan.resourceDemand).toEqual({ OreA: 4 });
    expect(unlocked.plan.recipes.map((entry) => entry.recipe)).toEqual(['Widget_Pure']);
    expect(factory(unlocked.plan)).toEqual({ Refinery: 1 });
  });

  /** A dry Recipe against a wet one, with the ore each spends as the only variable. */
  function wetAndDry(dryOre: number, wetOre: number): Dataset {
    return {
      source: TEST_SOURCE,
      parts: [
        { id: 'OreA', name: 'Ore A', state: 'solid' },
        { id: 'Water', name: 'Water', state: 'fluid' },
        { id: 'Widget', name: 'Widget', state: 'solid' },
      ],
      recipes: [
        {
          id: 'Widget_Base',
          name: 'Widget',
          building: 'Constructor',
          alternate: false,
          inputs: [{ part: 'OreA', rate: dryOre }],
          outputs: [{ part: 'Widget', rate: 10 }],
        },
        {
          id: 'Widget_Wet',
          name: 'Wet Widget',
          building: 'Refinery',
          alternate: false,
          inputs: [
            { part: 'OreA', rate: wetOre },
            { part: 'Water', rate: 10_000 },
          ],
          outputs: [{ part: 'Widget', rate: 10 }],
        },
      ],
      resources: [resource('OreA', 1, 60), resource('Water', 0, 120)],
    };
  }

  it('declines to squander a zero-weight Resource when nothing is gained by it', () => {
    // Both Recipes spend the same ore, so Scarcity Cost ties and the machine count
    // decides. Drinking 10,000 m³ a minute means 84 Water Extractors, so the dry
    // Recipe wins — which is exactly what extraction costing machines is for.
    const result = plan(wetAndDry(10, 10), [{ part: 'Widget', rate: 10 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes.map((entry) => entry.recipe)).toEqual(['Widget_Base']);
    expect(result.plan.resourceDemand).toEqual({ OreA: 10 });
  });

  it('still spends any amount of a free Resource to save a scarce one', () => {
    // The limit of the lexicographic order, pinned so nobody mistakes it for a bug.
    // Machines only ever break ties in Scarcity Cost, so saving a single unit of ore
    // outranks 84 Water Extractors however absurd that looks. Fixing it would mean
    // pricing the two against each other, which ADR-0001 rejects on purpose.
    const result = plan(wetAndDry(10, 9), [{ part: 'Widget', rate: 10 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes.map((entry) => entry.recipe)).toEqual(['Widget_Wet']);
    expect(result.plan.resourceDemand['OreA']).toBeCloseTo(9, 3);
    expect(result.plan.resourceDemand['Water']).toBeCloseTo(10_000, 3);
  });

  it('breaks a tie in Scarcity Cost on machine count', () => {
    // Two routes to the same Widget from the same ore at the same Rate, so nothing
    // separates them but the machines: one Assembler against two Constructors.
    const dataset: Dataset = {
      source: TEST_SOURCE,
      parts: [
        { id: 'OreA', name: 'Ore A', state: 'solid' },
        { id: 'Half', name: 'Half', state: 'solid' },
        { id: 'Widget', name: 'Widget', state: 'solid' },
      ],
      recipes: [
        {
          id: 'OneStep',
          name: 'One step',
          building: 'Assembler',
          alternate: false,
          inputs: [{ part: 'OreA', rate: 10 }],
          outputs: [{ part: 'Widget', rate: 10 }],
        },
        {
          id: 'TwoStepA',
          name: 'Two step, first',
          building: 'Constructor',
          alternate: false,
          inputs: [{ part: 'OreA', rate: 10 }],
          outputs: [{ part: 'Half', rate: 10 }],
        },
        {
          id: 'TwoStepB',
          name: 'Two step, second',
          building: 'Constructor',
          alternate: false,
          inputs: [{ part: 'Half', rate: 10 }],
          outputs: [{ part: 'Widget', rate: 10 }],
        },
      ],
      resources: [resource('OreA', 1, 60)],
    };

    const result = plan(dataset, [{ part: 'Widget', rate: 10 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes.map((entry) => entry.recipe)).toEqual(['OneStep']);
  });

  it('will not buy a machine with any extra Resource, however cheap', () => {
    // The one-step route costs one more ore but one fewer machine. Scarcity comes
    // first absolutely, so the extra machine is taken and the ore is not spent.
    const dataset: Dataset = {
      source: TEST_SOURCE,
      parts: [
        { id: 'OreA', name: 'Ore A', state: 'solid' },
        { id: 'Half', name: 'Half', state: 'solid' },
        { id: 'Widget', name: 'Widget', state: 'solid' },
      ],
      recipes: [
        {
          id: 'OneStep',
          name: 'One step',
          building: 'Assembler',
          alternate: false,
          inputs: [{ part: 'OreA', rate: 11 }],
          outputs: [{ part: 'Widget', rate: 10 }],
        },
        {
          id: 'TwoStepA',
          name: 'Two step, first',
          building: 'Constructor',
          alternate: false,
          inputs: [{ part: 'OreA', rate: 10 }],
          outputs: [{ part: 'Half', rate: 10 }],
        },
        {
          id: 'TwoStepB',
          name: 'Two step, second',
          building: 'Constructor',
          alternate: false,
          inputs: [{ part: 'Half', rate: 10 }],
          outputs: [{ part: 'Widget', rate: 10 }],
        },
      ],
      resources: [resource('OreA', 1, 60)],
    };

    const result = plan(dataset, [{ part: 'Widget', rate: 10 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes.map((entry) => entry.recipe).sort()).toEqual([
      'TwoStepA',
      'TwoStepB',
    ]);
    expect(result.plan.resourceDemand).toEqual({ OreA: 10 });
  });

  it('admits no ghost of a rejected Recipe at real Resource Weights', () => {
    // The same trade as above, but priced off the map's actual iron availability
    // rather than a weight of one. Phase two's ceiling has to hold at that scale
    // too: the sliver it can buy is its slack divided by the Resource Weight, so
    // a weight near 1e-5 magnifies any fixed slack a hundred thousand times.
    const dataset: Dataset = {
      source: TEST_SOURCE,
      parts: [
        { id: 'OreA', name: 'Ore A', state: 'solid' },
        { id: 'Half', name: 'Half', state: 'solid' },
        { id: 'Widget', name: 'Widget', state: 'solid' },
      ],
      recipes: [
        {
          id: 'OneStep',
          name: 'One step',
          building: 'Assembler',
          alternate: false,
          inputs: [{ part: 'OreA', rate: 11 }],
          outputs: [{ part: 'Widget', rate: 10 }],
        },
        {
          id: 'TwoStepA',
          name: 'Two step, first',
          building: 'Constructor',
          alternate: false,
          inputs: [{ part: 'OreA', rate: 10 }],
          outputs: [{ part: 'Half', rate: 10 }],
        },
        {
          id: 'TwoStepB',
          name: 'Two step, second',
          building: 'Constructor',
          alternate: false,
          inputs: [{ part: 'Half', rate: 10 }],
          outputs: [{ part: 'Widget', rate: 10 }],
        },
      ],
      resources: [
        {
          part: 'OreA',
          unbounded: false,
          availableByTier: [9210, 18420, 36840],
          extractors: [
            { building: 'Miner Mk.1', rate: 60 },
            { building: 'Miner Mk.2', rate: 120 },
            { building: 'Miner Mk.3', rate: 240 },
          ],
        },
      ],
    };

    const result = plan(dataset, [{ part: 'Widget', rate: 10 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes.map((entry) => entry.recipe).sort()).toEqual([
      'TwoStepA',
      'TwoStepB',
    ]);
    expect(result.plan.machinesByBuilding['Constructor']).toBe(2);
    expect(result.plan.resourceDemand).toEqual({ OreA: 10 });
  });

  it.each([0, 4, Number.NaN])(
    'rejects an Extractor Tier of %s rather than throwing out of solve',
    (tier) => {
      const result = solve(ingotDataset(), {
        targets: [{ part: 'IronIngot', rate: 60 }],
        extractorTier: tier as ExtractorTier,
      });

      expect(result.status).toBe('infeasible');
    },
  );

  /** Smelting that also drops Slag, and optionally something that eats the Slag. */
  function slagDataset(sink?: { consumes: number; produces: number }): Dataset {
    const base = ingotDataset();
    return {
      ...base,
      parts: [
        ...base.parts,
        { id: 'Slag', name: 'Slag', state: 'solid' },
        ...(sink === undefined ? [] : [{ id: 'Brick', name: 'Brick', state: 'solid' as const }]),
      ],
      recipes: [
        {
          ...base.recipes[0],
          outputs: [
            { part: 'IronIngot', rate: 30 },
            { part: 'Slag', rate: 10 },
          ],
        },
        ...(sink === undefined
          ? []
          : [
              {
                id: 'Brick',
                name: 'Brick',
                building: 'Constructor',
                alternate: false,
                inputs: [{ part: 'Slag', rate: sink.consumes }],
                outputs: [{ part: 'Brick', rate: sink.produces }],
              },
            ]),
      ],
    };
  }

  it('reports a Byproduct nothing consumes as Surplus, at its Rate', () => {
    const result = plan(slagDataset(), [{ part: 'IronIngot', rate: 30 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    // One Smelter makes the 30 ingots wanted and 10 Slag nobody asked for.
    expect(result.plan.surplus).toEqual({ Slag: 10 });
  });

  it('reports no Surplus for a Byproduct the chain consumes', () => {
    const result = plan(slagDataset({ consumes: 10, produces: 5 }), [
      { part: 'Brick', rate: 5 },
      { part: 'IronIngot', rate: 30 },
    ]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    // The Brick line eats exactly the 10 Slag the Smelter drops.
    expect(result.plan.surplus).toEqual({});
  });

  it('reports no Surplus at all for a chain with no loose ends', () => {
    const result = plan(chainDataset(), [{ part: 'IronPlate', rate: 20 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.surplus).toEqual({});
  });

  it('keeps Surplus apart from Resource Demand and from the Targets', () => {
    const result = plan(slagDataset(), [{ part: 'IronIngot', rate: 30 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    // The Target is met exactly, so it is not Surplus; the ore is Demand, not Surplus.
    expect(result.plan.surplus).toEqual({ Slag: 10 });
    expect(result.plan.resourceDemand).toEqual({ IronOre: 30 });
    expect(result.plan.surplus['IronIngot']).toBeUndefined();
    expect(result.plan.surplus['IronOre']).toBeUndefined();
  });

  it('prefers reusing a Byproduct over extracting more', () => {
    // Slag can be smelted back into ingots. Doing so is free, while more ore is not,
    // so the optimiser should take the Slag rather than mine for it.
    const base = ingotDataset();
    const dataset: Dataset = {
      ...base,
      parts: [...base.parts, { id: 'Slag', name: 'Slag', state: 'solid' }],
      recipes: [
        {
          ...base.recipes[0],
          outputs: [
            { part: 'IronIngot', rate: 30 },
            { part: 'Slag', rate: 30 },
          ],
        },
        {
          id: 'SlagIngot',
          name: 'Slag Ingot',
          building: 'Foundry',
          alternate: false,
          inputs: [{ part: 'Slag', rate: 30 }],
          outputs: [{ part: 'IronIngot', rate: 30 }],
        },
      ],
    };

    const result = plan(dataset, [{ part: 'IronIngot', rate: 60 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    // 30 ore gives 30 ingots and 30 Slag, and the Slag gives the other 30 ingots.
    expect(result.plan.resourceDemand).toEqual({ IronOre: 30 });
    expect(result.plan.surplus).toEqual({});
  });

  it('solves two mutually dependent Recipes, as a recycling loop demands', () => {
    // Plastic needs Rubber, Rubber needs Plastic. Neither can be unwound into the
    // other, so the pair only resolves if cycles are handled rather than avoided.
    const dataset: Dataset = {
      source: TEST_SOURCE,
      parts: [
        { id: 'Fuel', name: 'Fuel', state: 'fluid' },
        { id: 'Plastic', name: 'Plastic', state: 'solid' },
        { id: 'Rubber', name: 'Rubber', state: 'solid' },
      ],
      recipes: [
        {
          id: 'RecycledPlastic',
          name: 'Recycled Plastic',
          building: 'Refinery',
          alternate: false,
          inputs: [
            { part: 'Rubber', rate: 30 },
            { part: 'Fuel', rate: 30 },
          ],
          outputs: [{ part: 'Plastic', rate: 60 }],
        },
        {
          id: 'RecycledRubber',
          name: 'Recycled Rubber',
          building: 'Refinery',
          alternate: false,
          inputs: [
            { part: 'Plastic', rate: 30 },
            { part: 'Fuel', rate: 30 },
          ],
          outputs: [{ part: 'Rubber', rate: 60 }],
        },
      ],
      resources: [resource('Fuel', 1, 60)],
    };

    const result = plan(dataset, [{ part: 'Plastic', rate: 30 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    // Running plastic at p and rubber at r: rubber balances at 60r = 30p, so r = p/2,
    // and plastic nets 60p - 30r = 45p = 30, giving p = 2/3 and r = 1/3. Fuel is
    // 30(p + r) = 30.
    const machines = new Map(result.plan.recipes.map((entry) => [entry.recipe, entry.machines]));
    expect(machines.get('RecycledPlastic')).toBeCloseTo(2 / 3, 5);
    expect(machines.get('RecycledRubber')).toBeCloseTo(1 / 3, 5);
    expect(result.plan.resourceDemand['Fuel']).toBeCloseTo(30, 5);
    expect(result.plan.surplus).toEqual({});
  });

  it('returns the same Plan every time, since ties are no longer arbitrary', () => {
    const once = plan(chainDataset(), [{ part: 'IronPlate', rate: 20 }]);
    const twice = plan(chainDataset(), [{ part: 'IronPlate', rate: 20 }]);

    expect(once).toEqual(twice);
  });

  it('counts extractors alongside factory machines, under their own building', () => {
    const result = plan(ingotDataset(), [{ part: 'IronIngot', rate: 60 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    // 60 ore a minute from a 60/min extractor is one machine, beside the two Smelters.
    expect(result.plan.machinesByBuilding).toEqual({ Smelter: 2, Extractor: 1 });
  });

  it('needs fewer extractors at a higher Extractor Tier', () => {
    const dataset: Dataset = {
      ...ingotDataset(),
      resources: [
        {
          part: 'IronOre',
          unbounded: false,
          availableByTier: [9210, 18420, 36840],
          extractors: [
            { building: 'Miner Mk.1', rate: 60 },
            { building: 'Miner Mk.2', rate: 120 },
            { building: 'Miner Mk.3', rate: 240 },
          ],
        },
      ],
    };
    const at = (tier: ExtractorTier) =>
      plan(dataset, [{ part: 'IronIngot', rate: 240 }], undefined, tier);

    const [one, three] = [at(1), at(3)];
    expect(one.status).toBe('optimal');
    expect(three.status).toBe('optimal');
    if (one.status !== 'optimal' || three.status !== 'optimal') return;

    // The same 240 ore a minute: four Mk.1 Miners, or one Mk.3.
    expect(one.plan.machinesByBuilding['Miner Mk.1']).toBe(4);
    expect(three.plan.machinesByBuilding['Miner Mk.3']).toBe(1);
    expect(one.plan.resourceDemand).toEqual(three.plan.resourceDemand);
  });

  it('defaults to Mk.3 when the Request does not say', () => {
    const dataset: Dataset = {
      ...ingotDataset(),
      resources: [
        {
          part: 'IronOre',
          unbounded: false,
          availableByTier: [9210, 18420, 36840],
          extractors: [
            { building: 'Miner Mk.1', rate: 60 },
            { building: 'Miner Mk.2', rate: 120 },
            { building: 'Miner Mk.3', rate: 240 },
          ],
        },
      ],
    };

    const result = solve(dataset, { targets: [{ part: 'IronIngot', rate: 240 }] });

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.machinesByBuilding['Miner Mk.3']).toBe(1);
  });

  it('keeps float dust out of a machine count summed across Recipes', () => {
    // The solver rounds each variable, but adding two rounded values makes fresh
    // dust: 0.1 + 0.2 is 0.30000000000000004. Both Recipes share a building, so
    // the sum is what a player would see.
    const dataset: Dataset = {
      source: TEST_SOURCE,
      parts: [
        { id: 'OreA', name: 'Ore A', state: 'solid' },
        { id: 'WidgetA', name: 'Widget A', state: 'solid' },
        { id: 'WidgetB', name: 'Widget B', state: 'solid' },
      ],
      recipes: [
        {
          id: 'WidgetA',
          name: 'Widget A',
          building: 'Constructor',
          alternate: false,
          inputs: [{ part: 'OreA', rate: 100 }],
          outputs: [{ part: 'WidgetA', rate: 100 }],
        },
        {
          id: 'WidgetB',
          name: 'Widget B',
          building: 'Constructor',
          alternate: false,
          inputs: [{ part: 'OreA', rate: 100 }],
          outputs: [{ part: 'WidgetB', rate: 100 }],
        },
      ],
      resources: [resource('OreA', 1, 60)],
    };

    const result = plan(dataset, [
      { part: 'WidgetA', rate: 10 },
      { part: 'WidgetB', rate: 20 },
    ]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(factory(result.plan)).toEqual({ Constructor: 0.3 });
  });

  it('returns a Plan for a Target far beyond what the map could supply', () => {
    const result = plan(ingotDataset(), [{ part: 'IronIngot', rate: 1_000_000 }]);

    // Scarcity Cost prices Resources; it does not cap them. "Here is what it would
    // take" beats refusing to answer.
    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    // A solver works to a tolerance, so 1e6/30 is asserted as a closeness rather
    // than as exact float equality.
    expect(result.plan.resourceDemand['IronOre']).toBeCloseTo(1_000_000, 6);
    expect(factory(result.plan)['Smelter']).toBeCloseTo(1_000_000 / 30, 6);
  });
});
