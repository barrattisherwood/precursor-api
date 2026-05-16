import { Request, Response, NextFunction } from 'express';
import NodeCache from 'node-cache';

export const nodeCache = new NodeCache({ useClones: false });

export const cache = (ttl: number) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const bypass = 'no-cache' in req.query;
    const key = req.originalUrl;
    if (!bypass) {
      const cached = nodeCache.get(key);
      if (cached) {
        res.json(cached);
        return;
      }
    }

    const originalJson = res.json.bind(res);
    res.json = (data: unknown) => {
      nodeCache.set(key, data, ttl);
      return originalJson(data);
    };
    next();
  };
