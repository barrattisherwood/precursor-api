import { SkillTreeData } from '@precursor/engine';
import { logger } from '../logger';

const EMPTY_TREE: SkillTreeData = { passives: {} };

export async function fetchSkillTree(): Promise<SkillTreeData> {
  const base = process.env.REPOE_BASE_URL;
  if (!base) {
    logger.warn('REPOE_BASE_URL not set — skipping passive tree');
    return EMPTY_TREE;
  }
  const url = `${base}/passive_skill_trees/Default.json`;
  const res = await fetch(url);
  if (!res.ok) {
    logger.warn({ status: res.status, url }, 'Skill tree fetch failed — skipping passive tree');
    return EMPTY_TREE;
  }
  return res.json() as Promise<SkillTreeData>;
}
