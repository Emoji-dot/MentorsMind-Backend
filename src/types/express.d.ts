import 'express';

declare global {
  namespace Express {
    interface User {
      id: string;
      userId: string;
      email?: string;
      role: string;
      mfaVerified?: boolean;
      language?: string;
    }
  }
}

/**
 * Override Express query/params types so individual values are `string` (not `string | string[]`).
 * This matches actual runtime behaviour — Express only produces string[] for multi-value params
 * when using specific body-parsers, not for standard query strings.
 */
declare module 'express-serve-static-core' {
  interface Query {
    [key: string]: string | undefined;
  }
  interface ParamsDictionary {
    [key: string]: string;
  }
}

export {};
