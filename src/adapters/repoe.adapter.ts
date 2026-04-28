import { RePoEGem, RePoEMod } from '@precursor/engine';

const BASE = process.env.REPOE_BASE_URL!;

export async function fetchRePoE<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`RePoE fetch failed: ${file} ${res.status}`);
  return res.json() as Promise<T>;
}

type RawGem = {
  active_skill?: { display_name?: string; id?: string; types?: string[] } | null;
  base_item?: { id?: string; release_state?: string };
  display_name?: string;
  is_support?: boolean;
  per_level?: Record<string, unknown>;
  support_gem?: {
    allowed_types?: string[];
    excluded_types?: string[] | null;
    added_types?: string[] | null;
    supports_gems_only?: boolean;
  } | null;
};

export async function fetchGems(): Promise<RePoEGem[]> {
  const raw = await fetchRePoE<Record<string, RawGem>>('gems.json');
  return Object.entries(raw).map(([name, gem]) => {
    const isSupport = gem.is_support === true;
    // Active skills use active_skill.types (PascalCase gameplay tags).
    // Support gems have no active_skill; mark them with 'Support' so the normalizer
    // identifies them and uses support_gem.added_tags as scales_keywords.
    const tags = isSupport
      ? ['Support']
      : (gem.active_skill?.types ?? []);

    return {
      id: gem.base_item?.id ?? name,
      display_name: gem.display_name ?? gem.active_skill?.display_name ?? name,
      release_state: gem.base_item?.release_state ?? 'unreleased',
      tags,
      per_level: gem.per_level,
      support_gem: isSupport
        ? {
            // allowed_types = what skill types this support can be applied to;
            // stored as added_tags so extractScalesKeywords returns them.
            added_tags: gem.support_gem?.allowed_types ?? [],
            support_only_with: gem.support_gem?.allowed_types ?? [],
            excluded_tags: gem.support_gem?.excluded_types?.filter(Boolean) ?? [],
          }
        : undefined,
    };
  });
}

export async function fetchMods(): Promise<Record<string, RePoEMod>> {
  return fetchRePoE<Record<string, RePoEMod>>('mods.json');
}

export async function fetchStatTranslations(): Promise<Record<string, unknown>> {
  return fetchRePoE<Record<string, unknown>>('stat_translations.json');
}
