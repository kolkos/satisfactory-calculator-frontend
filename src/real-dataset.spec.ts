import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDataset } from './dataset/parse-dataset';
import { solve } from './optimiser/solve';

/**
 * The one place the committed dataset and the optimiser meet. Everything else is
 * tested on hand-written fixtures, which is the right way to pin behaviour but
 * never exercises the shape or the scale of the real thing: a few hundred Recipes,
 * and a Resource Weight table transcribed by hand.
 *
 * Its job is to catch a regeneration that produced something the solver cannot use,
 * not to re-verify optimisation. Assertions are therefore either structural or
 * arrived at on paper.
 */
const dataset = parseDataset(JSON.parse(readFileSync('public/dataset.json', 'utf8')));

const PLASTIC = 'Desc_Plastic_C';
const CRUDE_OIL = 'Desc_LiquidOil_C';
const HEAVY_OIL_RESIDUE = 'Desc_HeavyOilResidue_C';

const everyAlternate = new Set(
  dataset.recipes.filter((recipe) => recipe.alternate).map((recipe) => recipe.id),
);

describe('the committed dataset', () => {
  it('describes the whole game, not a fragment of it', () => {
    expect(dataset.resources).toHaveLength(13);
    expect(dataset.parts.length).toBeGreaterThan(100);
    expect(dataset.recipes.length).toBeGreaterThan(200);
    expect(everyAlternate.size).toBeGreaterThan(100);
    expect(dataset.source.revisions['Template:DocsRecipes.json']).toBeGreaterThan(0);
  });

  it('solves a Target whose answer can be checked on paper', () => {
    // The base recipe turns 30 Crude Oil into 20 Plastic and 10 Heavy Oil Residue.
    // A hundred Plastic a minute is five Refineries, so 150 oil in and 50 residue
    // over, which nothing in the default recipe set consumes.
    const result = solve(dataset, { targets: [{ part: PLASTIC, rate: 100 }] });

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    expect(result.plan.resourceDemand[CRUDE_OIL]).toBeCloseTo(150, 4);
    expect(result.plan.surplus[HEAVY_OIL_RESIDUE]).toBeCloseTo(50, 4);
    expect(result.plan.machinesByBuilding['Refinery']).toBeCloseTo(5, 4);
  });

  it('spends less and wastes nothing once the Alternates are unlocked', () => {
    const result = solve(dataset, { targets: [{ part: PLASTIC, rate: 100 }] }, everyAlternate);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    // The recycling loops consume the residue that the default set leaves over, and
    // Recycled Plastic and Recycled Rubber depend on each other — a cycle, resolved.
    expect(result.plan.surplus).toEqual({});
    expect(result.plan.resourceDemand[CRUDE_OIL]).toBeLessThan(150);

    // By name rather than by id: Recycled Plastic is Recipe_Alternate_Plastic_1_C
    // upstream, and the test is about the pair the game calls those, not the
    // class names it happens to carry.
    const byId = new Map(dataset.recipes.map((recipe) => [recipe.id, recipe.name]));
    const running = new Set(result.plan.recipes.map((entry) => byId.get(entry.recipe)));
    expect(running).toContain('Recycled Plastic');
    expect(running).toContain('Recycled Rubber');
  });

  it('asks only for Resources, at Rates a factory could carry', () => {
    const resources = new Set(dataset.resources.map((resource) => resource.part));
    const result = solve(dataset, { targets: [{ part: PLASTIC, rate: 100 }] }, everyAlternate);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    for (const [part, rate] of Object.entries(result.plan.resourceDemand)) {
      expect(resources).toContain(part);
      expect(Number.isFinite(rate)).toBe(true);
      expect(rate).toBeGreaterThan(0);
    }
  });

  it('names a real building for every Recipe it runs', () => {
    const buildings = new Set(dataset.recipes.map((recipe) => recipe.building));
    const result = solve(dataset, { targets: [{ part: PLASTIC, rate: 100 }] }, everyAlternate);

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;

    for (const entry of result.plan.recipes) {
      expect(entry.building.length).toBeGreaterThan(0);
      expect(buildings).toContain(entry.building);
    }
  });
});
