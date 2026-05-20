// Keyword profiles for each ascendancy class. Each profile lists the keywords that define
// that ascendancy's playstyle. During analyze-clusters, a cluster is tagged as relevant to
// an ascendancy if any of its element keywords match the profile (case-insensitive, 1+ overlap).
// Keywords are drawn from the set that appears in element.keywords / cluster.tags in the DB.
// Profiles intentionally overlap where ascendancies share themes (e.g. Warcry appears on both
// Titan and Warbringer) — that's correct: those clusters work for both.
export const ASCENDANCY_PROFILES: Record<string, string[]> = {
  Warrior1:   ['Slam', 'Warcry', 'Melee', 'Physical'],        // Titan
  Warrior2:   ['Warcry', 'Slam', 'Melee', 'Physical'],        // Warbringer
  Warrior3:   ['Melee', 'Physical', 'Attack'],                 // Smith of Kitava
  Sorceress1: ['Lightning', 'Cold', 'Spell', 'Area'],         // Stormweaver
  Sorceress2: ['Cold', 'Duration', 'Spell'],                   // Chronomancer
  Sorceress3: ['Chaos', 'Physical', 'Spell'],                  // Disciple of Varashta
  Ranger1:    ['Bow', 'Projectile', 'Attack'],                 // Deadeye
  Ranger3:    ['Poison', 'Chaos', 'Bow', 'Projectile'],       // Pathfinder
  Mercenary1: ['Physical', 'Projectile', 'Attack'],            // Tactician
  Mercenary2: ['Physical', 'Attack', 'Chaos'],                 // Witchhunter
  Mercenary3: ['Support', 'Attack', 'Spell'],                  // Gemling Legionnaire
  Monk2:      ['Lightning', 'Cold', 'Melee'],                  // Invoker
  Monk3:      ['Chaos', 'Melee'],                              // Acolyte of Chayula
  Witch1:     ['Fire', 'Minion', 'Chaos', 'Spell'],           // Infernalist
  Witch2:     ['Physical', 'Chaos', 'Bleed', 'Spell'],        // Blood Mage
  Witch3:     ['Minion', 'Cold', 'Chaos'],                     // Lich
  Huntress1:  ['Physical', 'Attack', 'Projectile'],            // Amazon
  Huntress3:  ['Totem', 'Poison', 'Chaos'],                    // Ritualist
  Druid1:     ['Lightning', 'Chaos', 'Spell'],                 // Oracle
  Druid2:     ['Totem', 'Lightning', 'Warcry'],                // Shaman
};
