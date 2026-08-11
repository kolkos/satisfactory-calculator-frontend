import { describe, expect, it } from 'vitest';
import { RESOURCES, buildDataset, totalAvailable, type WikiDocs } from './build-dataset';

/** The wiki templates key every entry to a one-element array. */
function docs(partial: Partial<WikiDocs>): WikiDocs {
  return { items: {}, recipes: {}, buildings: {}, ...partial };
}

const STAMP = { url: 'test', fetchedAt: '2026-08-11T00:00:00Z', revisions: {} };

describe('resource node table', () => {
  // Not a restatement of the arithmetic: publishedMax is transcribed from the
  // wiki's own "maximum per min" column, which was produced independently of the
  // node counts beside it. A typo in either would break the identity.
  it.each(RESOURCES.map((spec) => [spec.part, spec] as const))(
    'reproduces the published maximum for %s',
    (_part, spec) => {
      expect(totalAvailable(spec) * spec.publishedMaxFactor).toBeCloseTo(spec.publishedMax, 6);
    },
  );

  it('covers every Resource the game has', () => {
    expect(RESOURCES).toHaveLength(13);
  });

  it('gives water a Resource Weight of zero and everything else a positive one', () => {
    const weights = new Map(
      RESOURCES.map((spec) => [spec.part, spec.unbounded === true ? 0 : 1 / totalAvailable(spec)]),
    );

    expect(weights.get('Desc_Water_C')).toBe(0);
    for (const [part, weight] of weights) {
      if (part !== 'Desc_Water_C') expect(weight).toBeGreaterThan(0);
    }
  });

  it('prices uranium far above iron, since scarcity is the point', () => {
    const weight = (part: string) => {
      const spec = RESOURCES.find((candidate) => candidate.part === part);
      if (spec === undefined) throw new Error(`no spec for ${part}`);
      return 1 / totalAvailable(spec);
    };

    expect(weight('Desc_OreUranium_C')).toBeGreaterThan(weight('Desc_OreIron_C') * 40);
  });
});

describe('buildDataset', () => {
  it('converts amounts per craft into Rates per minute', () => {
    const dataset = buildDataset(
      docs({
        items: {
          Desc_OreIron_C: [{ className: 'Desc_OreIron_C', name: 'Iron Ore', form: 'solid' }],
          Desc_IronIngot_C: [{ className: 'Desc_IronIngot_C', name: 'Iron Ingot', form: 'solid' }],
        },
        buildings: {
          Desc_SmelterMk1_C: [{ className: 'Desc_SmelterMk1_C', name: 'Smelter' }],
        },
        recipes: {
          Recipe_IngotIron_C: [
            {
              className: 'Recipe_IngotIron_C',
              name: 'Iron Ingot',
              duration: 2,
              ingredients: [{ item: 'Desc_OreIron_C', amount: 1 }],
              products: [{ item: 'Desc_IronIngot_C', amount: 1 }],
              producedIn: ['Desc_SmelterMk1_C'],
              inBuildGun: false,
              inCustomizer: false,
              alternate: false,
            },
          ],
        },
      }),
      STAMP,
      [],
    );

    // One per craft, two seconds a craft, so thirty a minute.
    expect(dataset.recipes).toEqual([
      {
        id: 'Recipe_IngotIron_C',
        name: 'Iron Ingot',
        building: 'Smelter',
        alternate: false,
        inputs: [{ part: 'Desc_OreIron_C', rate: 30 }],
        outputs: [{ part: 'Desc_IronIngot_C', rate: 30 }],
      },
    ]);
  });

  it('maps each source form onto a Part State, keeping gas apart from fluid', () => {
    const dataset = buildDataset(
      docs({
        items: {
          Desc_OreIron_C: [{ className: 'Desc_OreIron_C', name: 'Iron Ore', form: 'solid' }],
          Desc_Water_C: [{ className: 'Desc_Water_C', name: 'Water', form: 'liquid' }],
          Desc_NitrogenGas_C: [
            { className: 'Desc_NitrogenGas_C', name: 'Nitrogen Gas', form: 'gas' },
          ],
        },
        buildings: { B: [{ className: 'B', name: 'Blender' }] },
        recipes: {
          R: [
            {
              className: 'R',
              name: 'R',
              duration: 60,
              ingredients: [
                { item: 'Desc_Water_C', amount: 1 },
                { item: 'Desc_NitrogenGas_C', amount: 1 },
              ],
              products: [{ item: 'Desc_OreIron_C', amount: 1 }],
              producedIn: ['B'],
              inBuildGun: false,
              inCustomizer: false,
              alternate: false,
            },
          ],
        },
      }),
      STAMP,
      [],
    );

    expect(new Map(dataset.parts.map((part) => [part.id, part.state]))).toEqual(
      new Map([
        ['Desc_OreIron_C', 'solid'],
        ['Desc_Water_C', 'fluid'],
        ['Desc_NitrogenGas_C', 'gas'],
      ]),
    );
  });

  it.each([
    ['a build gun recipe', { inBuildGun: true, inCustomizer: false, producedIn: ['B'] }],
    ['a customizer recipe', { inBuildGun: false, inCustomizer: true, producedIn: ['B'] }],
    ['a hand-craft-only recipe', { inBuildGun: false, inCustomizer: false, producedIn: [] }],
  ])('drops %s, which no machine can run', (_label, overrides) => {
    const dataset = buildDataset(
      docs({
        items: { P: [{ className: 'P', name: 'Part', form: 'solid' }] },
        buildings: { B: [{ className: 'B', name: 'Constructor' }] },
        recipes: {
          R: [
            {
              className: 'R',
              name: 'R',
              duration: 1,
              ingredients: [],
              products: [{ item: 'P', amount: 1 }],
              alternate: false,
              ...overrides,
            },
          ],
        },
      }),
      STAMP,
      [],
    );

    expect(dataset.recipes).toEqual([]);
    expect(dataset.parts).toEqual([]);
  });

  it('keeps the alternate flag, which the Unlock Profile is keyed on', () => {
    const dataset = buildDataset(
      docs({
        items: { P: [{ className: 'P', name: 'Part', form: 'solid' }] },
        buildings: { B: [{ className: 'B', name: 'Refinery' }] },
        recipes: {
          R: [
            {
              className: 'R',
              name: 'Alternate: Something',
              duration: 1,
              ingredients: [],
              products: [{ item: 'P', amount: 1 }],
              producedIn: ['B'],
              inBuildGun: false,
              inCustomizer: false,
              alternate: true,
            },
          ],
        },
      }),
      STAMP,
      [],
    );

    expect(dataset.recipes[0].alternate).toBe(true);
  });

  it('omits Parts no Recipe touches, so the model has no dead rows', () => {
    const dataset = buildDataset(
      docs({
        items: {
          P: [{ className: 'P', name: 'Part', form: 'solid' }],
          Unused: [{ className: 'Unused', name: 'Rifle Ammo', form: 'solid' }],
        },
        buildings: { B: [{ className: 'B', name: 'Constructor' }] },
        recipes: {
          R: [
            {
              className: 'R',
              name: 'R',
              duration: 1,
              ingredients: [],
              products: [{ item: 'P', amount: 1 }],
              producedIn: ['B'],
              inBuildGun: false,
              inCustomizer: false,
              alternate: false,
            },
          ],
        },
      }),
      STAMP,
      [],
    );

    expect(dataset.parts.map((part) => part.id)).toEqual(['P']);
  });

  it('refuses to build when a Resource class name is missing upstream', () => {
    // The Resource class names are transcribed from the wiki's Resource Node
    // pages, a different source from the items template, so they can drift apart.
    // Dropping the Resource would leave every chain needing it quietly infeasible.
    expect(() =>
      buildDataset(
        docs({
          items: { Desc_OreIron_C: [{ className: 'Desc_OreIron_C', name: 'Iron', form: 'solid' }] },
        }),
        STAMP,
      ),
    ).toThrow(/Desc_SAM_C/);
  });

  it('refuses to build when a Recipe names a building that is missing upstream', () => {
    const items = Object.fromEntries(
      RESOURCES.map((spec) => [
        spec.part,
        [{ className: spec.part, name: spec.part, form: 'solid' as const }],
      ]),
    );

    expect(() =>
      buildDataset(
        docs({
          items,
          buildings: {},
          recipes: {
            R: [
              {
                className: 'R',
                name: 'R',
                duration: 1,
                ingredients: [],
                products: [{ item: 'Desc_OreIron_C', amount: 1 }],
                producedIn: ['Desc_GoneMissing_C'],
                inBuildGun: false,
                inCustomizer: false,
                alternate: false,
              },
            ],
          },
        }),
        STAMP,
      ),
    ).toThrow(/Desc_GoneMissing_C/);
  });

  it('carries the source stamp through unchanged', () => {
    const dataset = buildDataset(docs({}), STAMP, []);

    expect(dataset.source).toEqual(STAMP);
  });
});
