import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
// Resolved from this file rather than the working directory, so the suite does not
// depend on being launched from the repository root.
const asset = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'dataset.json');
const dataset = parseDataset(JSON.parse(readFileSync(asset, 'utf8')));

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

    // Named rather than asserting nothing at all is left over: which trace a global
    // optimum leaves is a property of the recipe set, and one wiki edit could change
    // it without saying anything about whether the dataset is usable. What matters
    // is that the residue the default set could not place is now consumed.
    expect(result.plan.surplus[HEAVY_OIL_RESIDUE]).toBeUndefined();
    expect(result.plan.resourceDemand[CRUDE_OIL]).toBeLessThan(150);

    // By name rather than by id: Recycled Plastic is Recipe_Alternate_Plastic_1_C
    // upstream, and the test is about the pair the game calls those, not the
    // class names it happens to carry.
    const byId = new Map(dataset.recipes.map((recipe) => [recipe.id, recipe.name]));
    const running = new Set(result.plan.recipes.map((entry) => byId.get(entry.recipe)));
    expect(running).toContain('Recycled Plastic');
    expect(running).toContain('Recycled Rubber');
  });

  // Upstream keys everything by class name — Desc_Plastic_C, Build_SmelterMk1_C —
  // and the transformation's job is to resolve the ones a player reads into display
  // names. If that lookup regressed, every name would still be a valid non-empty
  // string and every id would still line up, so nothing structural would notice.
  const CLASS_NAME = /^(Desc|Build|Recipe)_|_C$/;

  it('resolves display names rather than passing class names through', () => {
    for (const recipe of dataset.recipes) {
      expect(recipe.building).not.toMatch(CLASS_NAME);
      expect(recipe.name).not.toMatch(CLASS_NAME);
    }
    for (const part of dataset.parts) {
      expect(part.name).not.toMatch(CLASS_NAME);
    }
    for (const resource of dataset.resources) {
      for (const extractor of resource.extractors) {
        expect(extractor.building).not.toMatch(CLASS_NAME);
      }
    }
  });

  it('produces the buildings the game actually has', () => {
    const buildings = new Set(dataset.recipes.map((recipe) => recipe.building));

    // A handful that must survive any regeneration, spanning solid and fluid lines.
    for (const building of ['Constructor', 'Smelter', 'Assembler', 'Refinery', 'Blender']) {
      expect(buildings).toContain(building);
    }
    // Twelve production buildings in the game; a regeneration that swept in the
    // build gun or the customizer would push this far past it.
    expect(buildings.size).toBeLessThan(20);
  });
});
