import { describe, it, expect } from './test-harness';
import {
  uuidSchema,
  idParamSchema,
  paginationSchema,
  emailSchema,
  passwordSchema,
  stellarAddressSchema,
  stellarTxHashSchema,
  longTextSchema,
  shortTextSchema,
  urlSchema,
} from '../schemas/common.schemas';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';
const VALID_STELLAR_ADDRESS = 'G' + 'A'.repeat(55);
const VALID_TX_HASH = 'a'.repeat(64);

describe('uuidSchema', () => {
  it('accepts a valid UUID v4', () => {
    expect(uuidSchema.safeParse(VALID_UUID).success).toBe(true);
  });

  it('rejects a non-UUID string (e.g. path traversal / SQLi attempt)', () => {
    expect(uuidSchema.safeParse('../../etc/passwd').success).toBe(false);
    expect(uuidSchema.safeParse("1' OR '1'='1").success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(uuidSchema.safeParse('').success).toBe(false);
  });
});

describe('idParamSchema', () => {
  it('accepts { params: { id: <uuid> } }', () => {
    expect(idParamSchema.safeParse({ params: { id: VALID_UUID } }).success).toBe(true);
  });

  it('rejects a non-UUID :id param with a structured error', () => {
    const result = idParamSchema.safeParse({ params: { id: 'not-a-uuid' } });
    expect(result.success).toBe(false);
  });
});

describe('paginationSchema', () => {
  it('defaults page/limit when absent', () => {
    const result = paginationSchema.safeParse({ query: {} });
    expect(result.success).toBe(true);
  });

  it('rejects a limit above the configured maximum (integer overflow guard)', () => {
    const result = paginationSchema.safeParse({ query: { limit: '999999999999' } });
    expect(result.success).toBe(false);
  });

  it('rejects a negative page number', () => {
    const result = paginationSchema.safeParse({ query: { page: '-1' } });
    expect(result.success).toBe(false);
  });
});

describe('emailSchema', () => {
  it('accepts a valid email and lowercases it', () => {
    const result = emailSchema.safeParse('User@Example.com');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('user@example.com');
  });

  it('rejects an invalid email', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('accepts a strong password', () => {
    expect(passwordSchema.safeParse('Str0ngPass1').success).toBe(true);
  });

  it('rejects a password missing a number', () => {
    expect(passwordSchema.safeParse('NoNumbersHere').success).toBe(false);
  });

  it('rejects a password below the minimum length', () => {
    expect(passwordSchema.safeParse('Sh0rt').success).toBe(false);
  });
});

describe('stellarAddressSchema', () => {
  it('accepts a well-formed G-address', () => {
    expect(stellarAddressSchema.safeParse(VALID_STELLAR_ADDRESS).success).toBe(true);
  });

  it('rejects an address with the wrong prefix', () => {
    expect(stellarAddressSchema.safeParse('X' + 'A'.repeat(55)).success).toBe(false);
  });

  it('rejects an address of the wrong length', () => {
    expect(stellarAddressSchema.safeParse('GABC').success).toBe(false);
  });
});

describe('stellarTxHashSchema', () => {
  it('accepts a 64-char hex hash', () => {
    expect(stellarTxHashSchema.safeParse(VALID_TX_HASH).success).toBe(true);
  });

  it('rejects a non-hex hash', () => {
    expect(stellarTxHashSchema.safeParse('z'.repeat(64)).success).toBe(false);
  });
});

describe('longTextSchema (bio/notes-style fields, max 2000)', () => {
  it('accepts text at the 2000 char boundary', () => {
    expect(longTextSchema.safeParse('a'.repeat(2000)).success).toBe(true);
  });

  it('rejects text over 2000 chars (long-string attack)', () => {
    expect(longTextSchema.safeParse('a'.repeat(2001)).success).toBe(false);
  });
});

describe('shortTextSchema (title/topic-style fields, max 500)', () => {
  it('accepts text at the 500 char boundary', () => {
    expect(shortTextSchema.safeParse('a'.repeat(500)).success).toBe(true);
  });

  it('rejects text over 500 chars', () => {
    expect(shortTextSchema.safeParse('a'.repeat(501)).success).toBe(false);
  });
});

describe('urlSchema', () => {
  it('accepts an https URL', () => {
    expect(urlSchema.safeParse('https://example.com/path').success).toBe(true);
  });

  it('rejects a non-http(s) protocol (e.g. javascript: XSS vector)', () => {
    expect(urlSchema.safeParse('javascript:alert(1)').success).toBe(false);
  });
});
