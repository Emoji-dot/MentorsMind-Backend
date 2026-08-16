/**
 * Validation Configuration
 * Central configuration for all input validation and sanitization settings.
 */

export const validationConfig = {
  /** Maximum allowed request body size in bytes (10 MB) */
  maxBodySize: 10 * 1024 * 1024,

  /** Maximum allowed URL length in characters */
  maxUrlLength: 2048,

  /** Maximum query string parameter value length */
  maxQueryParamLength: 500,

  /** String field length limits */
  string: {
    /** Very short strings: names, codes */
    minShort: 1,
    maxShort: 100,
    /** Medium strings: titles, subjects */
    minMedium: 1,
    maxMedium: 500,
    /** Long strings: bios, descriptions */
    maxLong: 2000,
    /** Extra-long strings: content, messages */
    maxXLong: 10000,
  },

  /** Pagination defaults and limits */
  pagination: {
    defaultPage: 1,
    defaultLimit: 10,
    maxLimit: 100,
    minLimit: 1,
  },

  /** Enhanced password policy for better security */
  password: {
    minLength: 12, // Increased from 8 to 12
    maxLength: 128,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecialChar: true, // Now required for better security
    minSpecialChars: 1,
    /** Disallow common weak patterns */
    disallowedPatterns: [
      /(.)\1{2,}/, // No more than 2 consecutive identical characters
      /123456/, // No sequential numbers
      /abcdef/i, // No sequential letters
      /qwerty/i, // No keyboard patterns
      /password/i, // No "password" in password
      /admin/i, // No "admin" in password
    ],
    /** List of commonly breached passwords to reject */
    commonPasswords: [
      'password123',
      '123456789',
      'qwerty123',
      'admin123',
      'welcome123',
      'password1',
      'letmein123',
    ],
  },

  /** File upload constraints */
  fileUpload: {
    /** Allowed MIME types for general image uploads */
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
    /** Allowed MIME types for document uploads */
    allowedDocumentTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    /** Max file size: 5 MB */
    maxImageSizeBytes: 5 * 1024 * 1024,
    /** Max document size: 20 MB */
    maxDocumentSizeBytes: 20 * 1024 * 1024,
    /** Max base64 avatar string length (approx 5 MB encoded) */
    maxBase64AvatarLength: 7 * 1024 * 1024,
    /** File extension validation */
    allowedImageExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
    allowedDocumentExtensions: ['.pdf', '.doc', '.docx'],
  },

  /** Stellar-specific validation */
  stellar: {
    /** Stellar public key (G-address) length */
    publicKeyLength: 56,
    /** Stellar public key prefix */
    publicKeyPrefix: 'G',
    /** Stellar transaction hash length */
    txHashLength: 64,
    /** Stellar amount precision (7 decimal places) */
    maxDecimalPlaces: 7,
    /** Maximum Stellar amount (100 billion XLM) */
    maxAmount: '100000000000',
    /** Minimum Stellar amount (0.0000001 XLM = 1 stroop) */
    minAmount: '0.0000001',
  },

  /** Enhanced XSS / injection prevention patterns */
  security: {
    /** Characters/patterns that are stripped from string inputs */
    dangerousPatterns: [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
      /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
      /<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi,
      /javascript:/gi,
      /vbscript:/gi,
      /data:text\/html/gi,
      /on\w+\s*=/gi,
      /expression\s*\(/gi,
      /url\s*\(/gi,
    ],
    /** SQL injection detection patterns (for logging/blocking) */
    sqlInjectionPatterns: [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|EXEC|UNION|DECLARE|GRANT|REVOKE)\b)/gi,
      /(-{2}|\/\*|\*\/|;--|#)/g,
      /(\bOR\b|\bAND\b)\s+[\w'"]+=[\w'"]+/gi,
      /\b(UNION\s+SELECT|SELECT\s+FROM|INSERT\s+INTO|UPDATE\s+SET|DELETE\s+FROM)\b/gi,
      /'(\s*(OR|AND)\s*'?\w+('|=))/gi,
      /(\|\||&&|\|\&)/g, // Logical operators that shouldn't be in normal input
    ],
    /** NoSQL injection patterns */
    nosqlInjectionPatterns: [
      /\$where/gi,
      /\$ne/gi,
      /\$gt/gi,
      /\$lt/gi,
      /\$or/gi,
      /\$and/gi,
      /\$regex/gi,
      /\$exists/gi,
    ],
    /** Command injection patterns */
    commandInjectionPatterns: [
      /[;&|`$(){}[\]<>]/g,
      /\b(cat|ls|pwd|id|whoami|uname|ps|netstat|ifconfig|ping|nslookup|curl|wget)\b/gi,
    ],
    /** Maximum number of special characters allowed in input */
    maxSpecialCharsRatio: 0.3, // Max 30% special characters
  },

  /** Rate limiting configurations */
  rateLimiting: {
    /** General API rate limit */
    general: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 1000,
    },
    /** Authentication endpoints rate limit */
    auth: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 5, // More restrictive for auth
    },
    /** Password reset rate limit */
    passwordReset: {
      windowMs: 60 * 60 * 1000, // 1 hour
      maxRequests: 3,
    },
    /** File upload rate limit */
    upload: {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 10,
    },
  },

  /** Input sanitization rules */
  sanitization: {
    /** Remove null bytes and control characters */
    removeControlChars: true,
    /** Normalize unicode */
    normalizeUnicode: true,
    /** Trim whitespace */
    trimWhitespace: true,
    /** Convert to lowercase for case-insensitive fields */
    lowercaseEmails: true,
    /** Maximum line length for multi-line input */
    maxLineLength: 1000,
  },

  /** Enhanced validation logging */
  logging: {
    /** Log failed validation attempts */
    logFailures: true,
    /** Log suspicious injection attempts */
    logSuspicious: true,
    /** Truncate long field values in logs */
    maxLogFieldLength: 200,
    /** Log validation performance metrics */
    logPerformance: false,
    /** Alert on multiple failed validations from same IP */
    alertOnRepeatedFailures: true,
    alertThreshold: 10, // Alert after 10 failures
  },
} as const;

export type ValidationConfig = typeof validationConfig;
