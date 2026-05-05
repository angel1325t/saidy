import type { Request, Response } from 'express';

export function getBearerToken(req: Request) {
  const authHeader = req.header('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7).trim() || null;
}

export function sendError(res: Response, status: number, message: string, details?: unknown) {
  return res.status(status).json({
    message,
    ...(details === undefined ? {} : { details })
  });
}
