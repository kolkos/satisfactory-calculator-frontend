/**
 * Regenerates the planner's dataset from the Satisfactory wiki's Docs templates.
 *
 *   npm run generate:dataset
 *
 * Never runs during a build or on CI — see ADR-0004. It writes two files: the
 * trimmed dataset the app fetches at runtime, and the unmodified upstream
 * responses beside it, so the trimmed output can always be re-derived from the
 * bytes it actually came from.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataset, type WikiDocs } from '../src/dataset/build-dataset.ts';
import { parseDataset, type DatasetSource } from '../src/dataset/parse-dataset.ts';

const API = 'https://satisfactory.wiki.gg/api.php';
const USER_AGENT = 'satisfactory-calculator-frontend (dataset generation)';

const TEMPLATES = {
  items: 'Template:DocsItems.json',
  recipes: 'Template:DocsRecipes.json',
  buildings: 'Template:DocsBuildings.json',
} as const;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATASET_FILE = join(root, 'public', 'dataset.json');
const SNAPSHOT_DIR = join(root, 'data', 'upstream');

async function api(params: Record<string, string>): Promise<unknown> {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2' })}`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/** The revision each template is at, so the dataset can name the bytes it came from. */
async function fetchRevisions(): Promise<Record<string, number>> {
  const data = (await api({
    action: 'query',
    prop: 'revisions',
    titles: Object.values(TEMPLATES).join('|'),
    rvprop: 'ids',
  })) as { query?: { pages?: { title: string; revisions?: { revid: number }[] }[] } };

  const revisions: Record<string, number> = {};
  for (const page of data.query?.pages ?? []) {
    const revid = page.revisions?.[0]?.revid;
    if (revid === undefined) throw new Error(`no revision for ${page.title}`);
    revisions[page.title] = revid;
  }
  return revisions;
}

async function fetchTemplate(title: string): Promise<{ raw: string; parsed: unknown }> {
  const data = (await api({ action: 'parse', page: title, prop: 'wikitext' })) as {
    parse?: { wikitext?: string };
  };
  const raw = data.parse?.wikitext;
  if (raw === undefined) throw new Error(`no wikitext for ${title}`);
  return { raw, parsed: JSON.parse(raw) };
}

async function main(): Promise<void> {
  console.log('Fetching revisions…');
  const revisions = await fetchRevisions();
  for (const [title, revid] of Object.entries(revisions)) {
    console.log(`  ${title} r${revid}`);
  }

  const docs: Record<string, unknown> = {};
  const snapshots: [string, string][] = [];
  for (const [key, title] of Object.entries(TEMPLATES)) {
    console.log(`Fetching ${title}…`);
    const { raw, parsed } = await fetchTemplate(title);
    docs[key] = parsed;
    snapshots.push([`${key}.json`, raw]);
  }

  const source: DatasetSource = {
    url: API,
    fetchedAt: new Date().toISOString(),
    revisions,
  };

  const dataset = buildDataset(docs as unknown as WikiDocs, source);

  // Round-trip through the boundary the app will use, so a dataset that would
  // fail at runtime fails here instead, while someone is watching.
  parseDataset(JSON.parse(JSON.stringify(dataset)));

  await mkdir(dirname(DATASET_FILE), { recursive: true });
  await writeFile(DATASET_FILE, `${JSON.stringify(dataset, null, 1)}\n`);

  await mkdir(SNAPSHOT_DIR, { recursive: true });
  for (const [name, raw] of snapshots) {
    await writeFile(join(SNAPSHOT_DIR, name), raw.endsWith('\n') ? raw : `${raw}\n`);
  }

  console.log(
    `\nWrote ${dataset.parts.length} Parts, ${dataset.recipes.length} Recipes ` +
      `(${dataset.recipes.filter((recipe) => recipe.alternate).length} alternates), ` +
      `${dataset.resources.length} Resources.`,
  );
  console.log(`  ${DATASET_FILE}`);
  console.log(`  ${SNAPSHOT_DIR}/`);
}

await main();
