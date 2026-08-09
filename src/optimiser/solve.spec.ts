import { describe, expect, it } from 'vitest';
import type { Dataset } from '../dataset/parse-dataset';
import { solve } from './solve';

/**
 * Iron Ore is smelted into Iron Ingot one for one, 30/min per Smelter.
 * Small enough that every expected number below can be worked out on paper.
 */
function ingotDataset(): Dataset {
  return {
    gameVersion: 'test',
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
});
