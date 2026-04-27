import { RePoEGem, RePoEMod } from '@precursor/engine';

const BASE = process.env.REPOE_BASE_URL!;

export async function fetchRePoE<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`RePoE fetch failed: ${file} ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchGems(): Promise<RePoEGem[]> {
  return fetchRePoE<RePoEGem[]>('gems.json');
}

export async function fetchMods(): Promise<Record<string, RePoEMod>> {
  return fetchRePoE<Record<string, RePoEMod>>('mods.json');
}

export async function fetchStatTranslations(): Promise<Record<string, unknown>> {
  return fetchRePoE<Record<string, unknown>>('stat_translations.json');
}
