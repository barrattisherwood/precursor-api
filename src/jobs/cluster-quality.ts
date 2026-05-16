import { IElement } from '@precursor/engine';

export const MAX_ITEM_AFFIXES = 2;
export const MAX_UNIQUE_ITEMS = 3;
export const MAX_SKILL_GEMS = 5;
export const MAX_PASSIVES = 3;

// Weapon groups: elements that require a specific weapon type equipped.
// Two elements from incompatible groups can never appear in the same build.
const WEAPON_INCOMPATIBLE_PAIRS: [string, string][] = [
  ['bow',       'crossbow'],
  ['bow',       'spear'],
  ['bow',       'quarterstaff'],
  ['bow',       'melee'],  // bow/quiver slot vs any melee-weapon skill
  ['crossbow',  'spear'],
  ['crossbow',  'quarterstaff'],
  ['crossbow',  'melee'],
  ['spear',     'shield'],       // spear is two-handed
  ['quarterstaff', 'shield'],    // quarterstaff is two-handed
  ['bow',       'shield'],       // bow + quiver, no shield slot
  ['crossbow',  'shield'],
];

function detectWeaponGroup(el: IElement): string | null {
  if (el.facet === 'unique_item') {
    const cls = el.meta.unique_item_class as string | undefined;
    if (cls === 'Bow')          return 'bow';
    if (cls === 'Quiver')       return 'bow';      // quiver requires a bow
    if (cls === 'Crossbow')     return 'crossbow';
    if (cls === 'Spear')        return 'spear';
    if (cls === 'Quarterstaff') return 'quarterstaff';
    if (cls === 'Shield')       return 'shield';
  }
  if (el.facet === 'skill_gem') {
    const tags = (el.meta.gem_tags ?? []) as string[];
    if (tags.includes('Bow'))          return 'bow';
    if (tags.includes('Crossbow'))     return 'crossbow';
    if (tags.includes('Spear'))        return 'spear';
    if (tags.includes('Quarterstaff')) return 'quarterstaff';
    // 'Melee' means the skill requires a melee weapon — excludes bow/crossbow
    if (tags.includes('Melee'))        return 'melee';
  }
  return null;
}

/**
 * Returns the rejection reason if the cluster fails quality checks, or null if it passes.
 */
export function isQualityCluster(
  partial: { element_ids: { toString(): string }[]; edges: { edge_type: string }[] },
  elementMap: Map<string, IElement>,
): string | null {
  const clusterEls = partial.element_ids
    .map(id => elementMap.get(id.toString()))
    .filter(Boolean) as IElement[];

  // Standalone keyword pairs (no condition/stat edges) are too broad to be actionable build advice.
  // Two elements sharing a keyword tag doesn't mean they form a coherent build.
  // Condition chain pairs (producer → scaler) are genuinely meaningful and exempt.
  if (clusterEls.length < 3) {
    const hasConditionEdge = partial.edges.some(
      e => e.edge_type === 'condition_chain' || e.edge_type === 'condition_amplification' || e.edge_type === 'stat_multiplication',
    );
    if (!hasConditionEdge) return 'keyword_pair';
  }

  if (clusterEls.filter(e => e.facet === 'item_affix').length > MAX_ITEM_AFFIXES)  return 'item_affixes';
  if (clusterEls.filter(e => e.facet === 'unique_item').length > MAX_UNIQUE_ITEMS) return 'unique_items';
  if (clusterEls.filter(e => e.facet === 'skill_gem').length > MAX_SKILL_GEMS)     return 'skill_gems';

  // Cap passive-only keyword hubs: keyword overlap between passives isn't a build synergy.
  // Exempt condition chains — a passive producing a condition that another passive scales is genuinely interesting.
  const hasConditionEdge = partial.edges.some(
    e => e.edge_type === 'condition_chain' || e.edge_type === 'condition_amplification',
  );
  if (!hasConditionEdge && clusterEls.filter(e => e.facet === 'passive_node').length > MAX_PASSIVES) return 'too_many_passives';

  // A character can only have one ascendancy class — reject clusters mixing nodes from different classes.
  const ascendancyClasses = new Set(
    clusterEls
      .filter(e => e.facet === 'ascendancy_node')
      .map(e => e.meta.ascendancy_class as string | undefined)
      .filter(Boolean),
  );
  if (ascendancyClasses.size > 1) return 'ascendancy_conflict';

  // Weapon type incompatibility
  const weaponGroups = new Set<string>();
  for (const el of clusterEls) {
    const group = detectWeaponGroup(el);
    if (group) weaponGroups.add(group);
  }
  for (const [a, b] of WEAPON_INCOMPATIBLE_PAIRS) {
    if (weaponGroups.has(a) && weaponGroups.has(b)) return 'weapon_incompatibility';
  }

  // Support linkability: only check when skill gems are present
  const skillGems = clusterEls.filter(e => e.facet === 'skill_gem');
  if (skillGems.length > 0) {
    for (const support of clusterEls.filter(e => e.facet === 'support_gem')) {
      const restricted = support.meta.support_restricted_to as string[] | null | undefined;
      if (!restricted || restricted.length === 0) continue;
      const canLink = skillGems.some(skill =>
        restricted.some(tag => (skill.meta.gem_tags as string[] | undefined)?.includes(tag)),
      );
      if (!canLink) return 'support_linkability';
    }
  }

  return null;
}
