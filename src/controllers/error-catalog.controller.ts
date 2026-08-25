import { Request, Response } from 'express';
import { ERROR_CATALOG, ErrorCode, ErrorCatalogResponse } from '../errors/error-codes';
import { detectLanguage, getT } from '../config/i18n.config';

export const getErrorCatalog = (req: Request, res: Response): void => {
  try {
    const acceptLanguage = req.headers['accept-language'] as string | undefined;
    const language = detectLanguage(acceptLanguage);

    let t: ReturnType<typeof getT>;
    try {
      t = getT(language);
    } catch {
      t = getT();
    }

    const catalog = Object.values(ERROR_CATALOG).map((entry) => ({
      code: entry.code,
      message: t(entry.i18nKey, entry.message),
      httpStatus: entry.httpStatus,
      i18nKey: entry.i18nKey,
    }));

    const response: ErrorCatalogResponse = {
      count: catalog.length,
      catalog,
    };

    res
      .setHeader('Cache-Control', 'public, max-age=3600')
      .json(response);
  } catch (error) {
    const fallbackCatalog = Object.values(ERROR_CATALOG).map((entry) => ({
      code: entry.code,
      message: entry.message,
      httpStatus: entry.httpStatus,
      i18nKey: entry.i18nKey,
    }));

    const response: ErrorCatalogResponse = {
      count: fallbackCatalog.length,
      catalog: fallbackCatalog,
    };

    res
      .setHeader('Cache-Control', 'public, max-age=3600')
      .json(response);
  }
};
