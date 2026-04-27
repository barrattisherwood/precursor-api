import { SkillTreeData } from '@precursor/engine';

export async function fetchSkillTree(): Promise<SkillTreeData> {
  const res = await fetch(`${process.env.SKILLTREE_REPO}/PoE2/data.json`);
  if (!res.ok) throw new Error(`Skill tree fetch failed: ${res.status}`);
  return res.json() as Promise<SkillTreeData>;
}
