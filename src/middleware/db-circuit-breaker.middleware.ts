import { Request, Response, NextFunction } from 'express';
import { getCircuitState, CircuitBreakerError } from '../services/database.service';
import config from '../config';

export function dbCircuitBreakerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!config.db.circuitBreakerEnabled) {
    return next();
  }

  const state = getCircuitState();

  if (state === 'OPEN') {
    // We'll throw and catch in error handler, but let's also pre-check here for faster response
    const error = new CircuitBreakerError('Database circuit breaker is open', 5);
    res.setHeader('Retry-After', '5');
    res.status(503).json({
      error: 'Service temporarily unavailable',
      message: error.message,
      retryAfter: 5,
    });
    return;
  }

  next();
}
