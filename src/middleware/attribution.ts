import { Request, Response, NextFunction } from 'express';

export const attributionHeader = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader(
    'X-Attribution',
    'Not affiliated with or endorsed by Grinding Gear Games.',
  );
  next();
};
