import { Poe2WikiUniqueItem } from '@precursor/engine';
import { logger } from '../logger';

const POE2WIKI_API = 'https://www.poe2wiki.net/w/api.php';
const FIELDS = 'name,base_item,class,required_level,stat_text,flavour_text';
const BATCH = 500;

export async function fetchUniqueItems(): Promise<Poe2WikiUniqueItem[]> {
  const items: Poe2WikiUniqueItem[] = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      action:  'cargoquery',
      tables:  'items',
      fields:  FIELDS,
      where:   'rarity="Unique"',
      orderby: 'items.name',
      limit:   String(BATCH),
      offset:  String(offset),
      format:  'json',
    });

    const res = await fetch(`${POE2WIKI_API}?${params}`);
    if (!res.ok) throw new Error(`poe2wiki fetch failed: ${res.status}`);

    const data = await res.json() as { cargoquery?: Array<{ title: Record<string, string | null> }> };
    const results = data.cargoquery ?? [];

    // Cargo returns field names with spaces matching the SQL alias; remap to our interface
    for (const entry of results) {
      const t = entry.title;
      items.push({
        name:           t['name'] ?? '',
        'base item':    t['base item'] ?? '',
        class:          t['class'] ?? '',
        'required level': t['required level'] ?? '1',
        stat_text:      t['stat text'] ?? null,
        flavour_text:   t['flavour text'] ?? null,
      });
    }

    if (results.length < BATCH) break;
    offset += BATCH;
  }

  logger.info({ count: items.length }, 'poe2wiki unique items fetched');
  return items;
}
