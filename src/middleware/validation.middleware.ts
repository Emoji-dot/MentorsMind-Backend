import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { validationResult } from 'express-validator';
import { ResponseUtil } from '../utils/response.utils';
import { ValidationError } from '../types/api.types';
import { logger } from '../utils/logger.utils';
import { validationConfig } from '../config/validation.config';
import { detectAndLogSqlInjection } from '../utils/sanitization.utils';

const handleValidationError = (error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (error instanceof ZodError) {
    const validationErrors: ValidationError[] = error.issues.map((err: any) => ({
      field: err.path.join('.'),
      message: err.message,
      code: err.code,
    }));

    if (validationConfig.logging.logFailures) {
      logger.warn('Validation failed', {
        path: req.originalUrl,
        method: req.method,
        errors: validationErrors,
      });
    }

    ResponseUtil.validationError(res, validationErrors);
    return;
  }
  next(error);
};

export const validate = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (validationConfig.logging.logSuspicious) {
        detectAndLogSqlInjection(JSON.stringify(req.body), 'body');
        detectAndLogSqlInjection(JSON.stringify(req.query), 'query');
      }

      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      handleValidationError(error, req, res, next);
    }
  };
};

export const validateBody = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (validationConfig.logging.logSuspicious) {
        detectAndLogSqlInjection(JSON.stringify(req.body), 'body');
      }
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (error) {
      handleValidationError(error, req, res, next);
    }
  };
};

export const validateQuery = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (validationConfig.logging.logSuspicious) {
        detectAndLogSqlInjection(JSON.stringify(req.query), 'query');
      }
      const validated = await schema.parseAsync(req.query);
      req.query = validated as any;
      next();
    } catch (error) {
      handleValidationError(error, req, res, next);
    }
  };
};

export const validateParams = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = await schema.parseAsync(req.params);
      req.params = validated as any;
      next();
    } catch (error) {
      handleValidationError(error, req, res, next);
    }
  };
};

export const validationMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      errors: errors.array().map(err => ({
        field: (err as any).path || (err as any).param,
        message: err.msg,
      }))
    });
    return;
  }
  next();
};
