import { describe, expect, it } from 'vitest';
import { parseDataset } from './parse-dataset';

function validRecipe(): Record<string, unknown> {
  return {
    id: 'IronIngot',
    name: 'Iron Ingot',
    building: 'Smelter',
    alternate: false,
    inputs: [{ part: 'IronOre', rate: 30 }],
    outputs: [{ part: 'IronIngot', rate: 30 }],
  };
}

function validResource(): Record<string, unknown> {
  return {
    part: 'IronOre',
    unbounded: false,
    availableByTier: [9210, 18420, 36840],
    extractors: [
      { building: 'Miner Mk.1', rate: 60 },
      { building: 'Miner Mk.2', rate: 120 },
      { building: 'Miner Mk.3', rate: 240 },
    ],
  };
}

/** A minimal dataset that parses cleanly. Tests override one field at a time. */
function validRaw(): Record<string, unknown> {
  return {
    source: {
      url: 'https://satisfactory.wiki.gg/api.php',
      fetchedAt: '2026-08-11T00:00:00Z',
      revisions: { 'Template:DocsRecipes.json': 62572 },
    },
    parts: [
      { id: 'IronOre', name: 'Iron Ore', state: 'solid' },
      { id: 'IronIngot', name: 'Iron Ingot', state: 'solid' },
    ],
    recipes: [validRecipe()],
    resources: [validResource()],
  };
}

describe('parseDataset', () => {
  it('accepts a well-formed dataset', () => {
    const dataset = parseDataset(validRaw());

    expect(dataset.source.revisions).toEqual({ 'Template:DocsRecipes.json': 62572 });
    expect(dataset.parts).toHaveLength(2);
    expect(dataset.recipes[0].building).toBe('Smelter');
    expect(dataset.recipes[0].inputs[0]).toEqual({ part: 'IronOre', rate: 30 });
    expect(dataset.resources[0].availableByTier).toEqual([9210, 18420, 36840]);
    expect(dataset.resources[0].extractors[2]).toEqual({ building: 'Miner Mk.3', rate: 240 });
  });

  it('rejects a Part missing its id, naming the field', () => {
    const raw = validRaw();
    raw['parts'] = [{ name: 'Iron Ore', state: 'solid' }];

    expect(() => parseDataset(raw)).toThrow(/parts\[0]\.id/);
  });

  it('rejects a Recipe input referencing an unknown Part, naming the field', () => {
    const raw = validRaw();
    raw['recipes'] = [{ ...validRecipe(), inputs: [{ part: 'CopperOre', rate: 30 }] }];

    expect(() => parseDataset(raw)).toThrow(/recipes\[0]\.inputs\[0]\.part/);
  });

  it('rejects a duplicate Part id, naming the field', () => {
    const raw = validRaw();
    raw['parts'] = [
      { id: 'IronOre', name: 'Iron Ore', state: 'solid' },
      { id: 'IronIngot', name: 'Iron Ingot', state: 'solid' },
      { id: 'IronOre', name: 'Iron Ore (stale duplicate)', state: 'solid' },
    ];

    expect(() => parseDataset(raw)).toThrow(/parts\[2]\.id/);
  });

  it('rejects a duplicate Recipe id, naming the field', () => {
    const raw = validRaw();
    raw['recipes'] = [validRecipe(), { ...validRecipe(), building: 'Foundry' }];

    expect(() => parseDataset(raw)).toThrow(/recipes\[1]\.id/);
  });

  it('accepts every Part State, including gas', () => {
    const raw = validRaw();
    raw['parts'] = [
      { id: 'IronOre', name: 'Iron Ore', state: 'solid' },
      { id: 'IronIngot', name: 'Iron Ingot', state: 'solid' },
      { id: 'Water', name: 'Water', state: 'fluid' },
      { id: 'NitrogenGas', name: 'Nitrogen Gas', state: 'gas' },
    ];

    expect(parseDataset(raw).parts.map((part) => part.state)).toEqual([
      'solid',
      'solid',
      'fluid',
      'gas',
    ]);
  });

  it('rejects a Part State outside the three known states, naming the field', () => {
    const raw = validRaw();
    raw['parts'] = [{ id: 'Plasma', name: 'Plasma', state: 'plasma' }];

    expect(() => parseDataset(raw)).toThrow(/parts\[0]\.state/);
  });

  it('rejects a negative Rate with a legible message', () => {
    const raw = validRaw();
    raw['recipes'] = [{ ...validRecipe(), inputs: [{ part: 'IronOre', rate: -30 }] }];

    expect(() => parseDataset(raw)).toThrow(
      /recipes\[0]\.inputs\[0]\.rate: expected a number greater than zero/,
    );
  });

  it('accepts an unbounded Resource, which has no availability to state', () => {
    const raw = validRaw();
    raw['parts'] = [
      { id: 'IronOre', name: 'Iron Ore', state: 'solid' },
      { id: 'IronIngot', name: 'Iron Ingot', state: 'solid' },
      { id: 'Water', name: 'Water', state: 'fluid' },
    ];
    raw['resources'] = [
      {
        part: 'Water',
        unbounded: true,
        availableByTier: [],
        extractors: [{ building: 'Water Extractor', rate: 120 }],
      },
    ];

    const resource = parseDataset(raw).resources[0];
    expect(resource.unbounded).toBe(true);
    expect(resource.availableByTier).toEqual([]);
  });

  it('accepts a single-tier Resource, for extractors that have no generations', () => {
    const raw = validRaw();
    raw['resources'] = [
      {
        part: 'IronOre',
        unbounded: false,
        availableByTier: [5040],
        extractors: [{ building: 'Oil Extractor', rate: 120 }],
      },
    ];

    expect(parseDataset(raw).resources[0].availableByTier).toEqual([5040]);
  });

  it('rejects a bounded Resource with no availability, naming the field', () => {
    const raw = validRaw();
    raw['resources'] = [{ ...validResource(), availableByTier: [] }];

    expect(() => parseDataset(raw)).toThrow(/resources\[0]\.availableByTier/);
  });

  it('rejects a tier count that is neither one nor three, naming the field', () => {
    const raw = validRaw();
    raw['resources'] = [
      {
        ...validResource(),
        availableByTier: [1, 2],
        extractors: [
          { building: 'A', rate: 1 },
          { building: 'B', rate: 2 },
        ],
      },
    ];

    expect(() => parseDataset(raw)).toThrow(/resources\[0]\.extractors/);
  });

  it('rejects availability and extractors of differing length, naming the field', () => {
    const raw = validRaw();
    raw['resources'] = [{ ...validResource(), availableByTier: [9210] }];

    expect(() => parseDataset(raw)).toThrow(/resources\[0]\.availableByTier/);
  });

  it('rejects a duplicate Resource row for one Part, naming the field', () => {
    const raw = validRaw();
    raw['resources'] = [validResource(), validResource()];

    expect(() => parseDataset(raw)).toThrow(/resources\[1]\.part/);
  });

  it('rejects a Resource referencing an unknown Part, naming the field', () => {
    const raw = validRaw();
    raw['resources'] = [{ ...validResource(), part: 'CopperOre' }];

    expect(() => parseDataset(raw)).toThrow(/resources\[0]\.part/);
  });
});
