import { SkillTreeData } from '@precursor/engine';
import { logger } from '../logger';

const EMPTY_TREE: SkillTreeData = { nodes: {}, classes: [] };

export async function fetchSkillTree(): Promise<SkillTreeData> {
  const url = `${process.env.SKILLTREE_REPO}/PoE2/data.json`;
  if (!process.env.SKILLTREE_REPO) {
    logger.warn('SKILLTREE_REPO not set — skipping passive tree');
    return EMPTY_TREE;
  }
  const res = await fetch(url);
  if (!res.ok) {
    logger.warn({ status: res.status, url }, 'Skill tree fetch failed — skipping passive tree');
    return EMPTY_TREE;
  }
  return res.json() as Promise<SkillTreeData>;
}
