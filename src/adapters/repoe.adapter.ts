import { RePoEGem, RePoEMod } from '@precursor/engine';

const BASE = process.env.REPOE_BASE_URL!;

// Tags the engine's keyword algorithm assigns specificity to, plus common PoE2 types.
// Filtering to these prevents the weight denominator being bloated by meta-tags like
// Trappable/Totemable/Triggerable/Unleashable which carry no synergy signal.
const SYNERGY_KEYWORDS = new Set([
  'Damage', 'Spell', 'Attack', 'Melee', 'Minion', 'Duration',
  'Fire', 'Cold', 'Lightning', 'Physical', 'Chaos',
  'Projectile', 'Area', 'AoE',
  'Ignite', 'Freeze', 'Shock', 'Chill', 'Poison', 'Bleed', 'Bleeding',
  'Slam', 'Channelling', 'Channeling', 'Mark', 'Herald', 'Warcry',
  'Bow', 'Crossbow', 'Strike',
]);

export async function fetchRePoE<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`RePoE fetch failed: ${file} ${res.status}`);
  return res.json() as Promise<T>;
}

type RawSkillGem = {
  base_item?: { id?: string; display_name?: string; release_state?: string };
  gem_type?: 'active' | 'support';
  crafting_level?: number | null;
  grants_skills?: string[];
  tags?: string[];
};

type RawSkillDef = {
  active_skill?: { types?: string[] } | null;
  is_support?: boolean;
  per_level?: Record<string, unknown>;
  support_gem?: {
    allowed_types?: string[];
    added_types?: string[] | null;
    excluded_types?: string[] | null;
  } | null;
};

export async function fetchGems(): Promise<RePoEGem[]> {
  const [skillGems, skills] = await Promise.all([
    fetchRePoE<Record<string, RawSkillGem>>('skill_gems.json'),
    fetchRePoE<Record<string, RawSkillDef>>('skills.json'),
  ]);

  return Object.entries(skillGems)
    .filter(([, gem]) =>
      gem.base_item?.release_state === 'released' &&
      // Exclude non-equippable skills (ascendancy, unique-item triggers, monster skills).
      // Support gems always have crafting_level 0; active gems only if player-equippable.
      (gem.gem_type === 'support' || (gem.crafting_level ?? 0) > 0),
    )
    .map(([key, gem]) => {
      const isSupport = gem.gem_type === 'support';
      const skillId = gem.grants_skills?.[0];
      const skill = skillId ? skills[skillId] : undefined;

      const rawTags = isSupport
        ? ['Support']
        : (skill?.active_skill?.types ?? []).filter(t => SYNERGY_KEYWORDS.has(t));

      return {
        id: gem.base_item?.id ?? key,
        display_name: gem.base_item?.display_name ?? key,
        release_state: gem.base_item?.release_state ?? 'unreleased',
        tags: rawTags,
        per_level: skill?.per_level,
        support_gem: isSupport
          ? {
              // added_tags drives scales_keywords in the engine — use added_types (what this
              // gem explicitly adds to skills) filtered to synergy-relevant keywords.
              // Fall back to filtered allowed_types so support gems with null added_types
              // still carry a keyword signal.
              added_tags: (
                skill?.support_gem?.added_types?.filter(Boolean).filter(t => SYNERGY_KEYWORDS.has(t)) ??
                skill?.support_gem?.allowed_types?.filter(t => SYNERGY_KEYWORDS.has(t)) ??
                []
              ),
              support_only_with: skill?.support_gem?.allowed_types ?? [],
              excluded_tags: skill?.support_gem?.excluded_types?.filter(Boolean) ?? [],
            }
          : undefined,
      };
    });
}

export async function fetchMods(): Promise<Record<string, RePoEMod>> {
  return fetchRePoE<Record<string, RePoEMod>>('mods.json');
}

export async function fetchStatTranslations(): Promise<Record<string, unknown>> {
  return fetchRePoE<Record<string, unknown>>('stat_translations/English.json');
}
