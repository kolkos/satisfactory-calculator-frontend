import { describe, expect, it } from 'vitest';
import type { Dataset } from '../dataset/parse-dataset';
import { solve } from './solve';

const TEST_SOURCE = { url: 'test', fetchedAt: '2026-01-01T00:00:00Z', revisions: {} };

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
    resources: [{ part: 'IronOre', weight: 0.0001, extractorRate: 60 }],
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
    resources: [
      { part: 'OreA', weight: weights.oreA, extractorRate: 60 },
      { part: 'OreB', weight: weights.oreB, extractorRate: 60 },
    ],
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
    resources: [{ part: 'OreA', weight: 1, extractorRate: 60 }],
  };
}

describe('solve', () => {
  it('resolves a single Target through one Recipe to one Resource', () => {
    const result = solve(ingotDataset(), [{ part: 'IronIngot', rate: 60 }]);

    // 60 ingots a minute needs two Smelters at 30 each, eating 60 ore a minute.
    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes).toEqual([
      { recipe: 'IronIngot', building: 'Smelter', machines: 2 },
    ]);
    expect(result.plan.machinesByBuilding).toEqual({ Smelter: 2 });
    expect(result.plan.resourceDemand).toEqual({ IronOre: 60 });
  });

  it('walks a chain down to the Resource, grouping machines by building', () => {
    const result = solve(chainDataset(), [{ part: 'IronPlate', rate: 20 }]);

    // 20 plates needs 1 Constructor, which eats 30 ingots, which needs 1 Smelter,
    // which eats 30 ore.
    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.machinesByBuilding).toEqual({ Smelter: 1, Constructor: 1 });
    expect(result.plan.resourceDemand).toEqual({ IronOre: 30 });
  });

  it('satisfies several Targets in one call', () => {
    const result = solve(chainDataset(), [
      { part: 'IronPlate', rate: 20 },
      { part: 'IronIngot', rate: 30 },
    ]);

    // The plate line eats 30 ingots and 30 more are wanted outright, so 60 ingots
    // in total: 2 Smelters, 1 Constructor, 60 ore.
    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.machinesByBuilding).toEqual({ Smelter: 2, Constructor: 1 });
    expect(result.plan.resourceDemand).toEqual({ IronOre: 60 });
  });

  it('reports infeasible, not an empty Plan, when no chain reaches the Target', () => {
    const dataset = ingotDataset();
    const unreachable: Dataset = {
      ...dataset,
      parts: [...dataset.parts, { id: 'Screw', name: 'Screw', state: 'solid' }],
    };

    const result = solve(unreachable, [{ part: 'Screw', rate: 10 }]);

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

    const result = solve(withByproduct, [{ part: 'IronIngot', rate: 30 }]);

    // Nothing consumes Slag. Under equality this would be infeasible; under the
    // inequality the Smelter simply runs and the Slag piles up.
    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.machinesByBuilding).toEqual({ Smelter: 1 });
  });

  it('returns fractional machine counts rather than rounding up', () => {
    const result = solve(ingotDataset(), [{ part: 'IronIngot', rate: 45 }]);

    // 45 a minute is one and a half Smelters: two machines, the last at 50%.
    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.machinesByBuilding).toEqual({ Smelter: 1.5 });
    expect(result.plan.resourceDemand).toEqual({ IronOre: 45 });
  });

  it('adds up several Targets naming the same Part', () => {
    const result = solve(ingotDataset(), [
      { part: 'IronIngot', rate: 30 },
      { part: 'IronIngot', rate: 30 },
    ]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.machinesByBuilding).toEqual({ Smelter: 2 });
  });

  it('answers a Target that is itself a Resource', () => {
    const result = solve(ingotDataset(), [{ part: 'IronOre', rate: 120 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes).toEqual([]);
    expect(result.plan.resourceDemand).toEqual({ IronOre: 120 });
  });

  it('names the Part when a Target is not in the Dataset', () => {
    const result = solve(ingotDataset(), [{ part: 'Concrete', rate: 10 }]);

    expect(result.status).toBe('infeasible');
    if (result.status !== 'infeasible') return;

    expect(result.reason).toMatch(/Concrete/);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['not a number', Number.NaN],
  ])('rejects a %s Target Rate rather than returning an empty Plan', (_label, rate) => {
    const result = solve(ingotDataset(), [{ part: 'IronIngot', rate }]);

    expect(result.status).toBe('infeasible');
    if (result.status !== 'infeasible') return;

    expect(result.reason).toMatch(/IronIngot/);
  });

  it('keeps Scarcity Cost out of the Plan', () => {
    const result = solve(ingotDataset(), [{ part: 'IronIngot', rate: 60 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(Object.keys(result.plan).sort()).toEqual([
      'machinesByBuilding',
      'recipes',
      'resourceDemand',
    ]);
    expect(JSON.stringify(result.plan)).not.toMatch(/scarcity/i);
  });

  it('prefers the abundant Resource even though it spends five times the units', () => {
    // Through A: 10 units at weight 1 = 10. Through B: 50 units at weight 0.01 = 0.5.
    const result = solve(choiceDataset({ oreA: 1, oreB: 0.01 }), [{ part: 'Widget', rate: 10 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes.map((entry) => entry.recipe)).toEqual(['Widget_FromB']);
    expect(result.plan.resourceDemand).toEqual({ OreB: 50 });
  });

  it('follows the Resource Weights rather than the order Recipes appear in', () => {
    // Same Recipes, scarcity swapped: now A is the cheap route and B the expensive one.
    const result = solve(choiceDataset({ oreA: 0.01, oreB: 1 }), [{ part: 'Widget', rate: 10 }]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes.map((entry) => entry.recipe)).toEqual(['Widget_FromA']);
    expect(result.plan.resourceDemand).toEqual({ OreA: 10 });
  });

  it('never uses an Alternate the Unlock Profile does not hold', () => {
    const result = solve(alternateDataset(), [{ part: 'Widget', rate: 10 }], new Set());

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.recipes.map((entry) => entry.recipe)).toEqual(['Widget_Base']);
    expect(result.plan.resourceDemand).toEqual({ OreA: 10 });
  });

  it('treats an empty Unlock Profile as the default, so the Profile is optional', () => {
    const withoutProfile = solve(alternateDataset(), [{ part: 'Widget', rate: 10 }]);
    const withEmptyProfile = solve(alternateDataset(), [{ part: 'Widget', rate: 10 }], new Set());

    expect(withoutProfile).toEqual(withEmptyProfile);
  });

  it('returns a different Plan once the Alternate is unlocked', () => {
    const locked = solve(alternateDataset(), [{ part: 'Widget', rate: 10 }], new Set());
    const unlocked = solve(
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
    expect(unlocked.plan.machinesByBuilding).toEqual({ Refinery: 1 });
  });

  it('still squanders a zero-weight Resource, because nothing yet costs machines', () => {
    // Pins today's behaviour so #7 has something to break. An Alternate that saves
    // one unit of ore by drinking 10,000 m³ of water wins outright, because a
    // Resource Weight of zero makes the water free and no machine cost opposes it.
    const dataset: Dataset = {
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
          inputs: [{ part: 'OreA', rate: 10 }],
          outputs: [{ part: 'Widget', rate: 10 }],
        },
        {
          id: 'Widget_Wet',
          name: 'Wet Widget',
          building: 'Refinery',
          alternate: true,
          inputs: [
            { part: 'OreA', rate: 9 },
            { part: 'Water', rate: 10_000 },
          ],
          outputs: [{ part: 'Widget', rate: 10 }],
        },
      ],
      resources: [
        { part: 'OreA', weight: 1, extractorRate: 60 },
        { part: 'Water', weight: 0, extractorRate: 120 },
      ],
    };

    const result = solve(dataset, [{ part: 'Widget', rate: 10 }], new Set(['Widget_Wet']));

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.resourceDemand).toEqual({ OreA: 9, Water: 10_000 });
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
      resources: [{ part: 'OreA', weight: 1, extractorRate: 60 }],
    };

    const result = solve(dataset, [
      { part: 'WidgetA', rate: 10 },
      { part: 'WidgetB', rate: 20 },
    ]);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.machinesByBuilding).toEqual({ Constructor: 0.3 });
  });

  it('returns a Plan for a Target far beyond what the map could supply', () => {
    const result = solve(ingotDataset(), [{ part: 'IronIngot', rate: 1_000_000 }]);

    // Scarcity Cost prices Resources; it does not cap them. "Here is what it would
    // take" beats refusing to answer.
    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    // A solver works to a tolerance, so 1e6/30 is asserted as a closeness rather
    // than as exact float equality.
    expect(result.plan.resourceDemand['IronOre']).toBeCloseTo(1_000_000, 6);
    expect(result.plan.machinesByBuilding['Smelter']).toBeCloseTo(1_000_000 / 30, 6);
  });
});
