import { Router, Request, Response } from 'express';
import { EconomySnapshot } from '../models/economy-snapshot.model';
import { cache } from '../middleware/cache';

export const economyRouter = Router();

// GET /api/economy/current
economyRouter.get('/current', cache(300), async (_req: Request, res: Response) => {
  try {
    const snapshot = await EconomySnapshot.findOne().sort({ captured_at: -1 });
    if (!snapshot) {
      res.status(404).json({ error: 'No economy data yet' });
      return;
    }
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
