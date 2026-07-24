import helmet from 'helmet';
import { Request, Response, NextFunction } from 'express';

export const securityMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  frameguard: {
    action: 'deny',
  },
  noSniff: true,
  xssFilter: true,
});

import { sanitizeObject, detectAndLogSqlInjection } from '../utils/sanitization.utils';

export const sanitizeInput = (req: Request, _res: Response, next: NextFunction): void => {
  const requestId = req.headers['x-request-id'] as string;

  if (req.body) {
    req.body = sanitizeObject(req.body);
    detectAndLogSqlInjection(JSON.stringify(req.body), 'body', requestId);
  }

  // req.query and req.params are read-only getters in Express 5 — they
  // cannot be mutated in place, so we only run detection logging here.
  // Rejection of malicious/malformed input happens via Zod schemas in
  // the `validate()` middleware applied per-route.
  if (req.query && Object.keys(req.query).length > 0) {
    detectAndLogSqlInjection(JSON.stringify(req.query), 'query', requestId);
  }
  if (req.params && Object.keys(req.params).length > 0) {
    detectAndLogSqlInjection(JSON.stringify(req.params), 'params', requestId);
  }

  next();
};
