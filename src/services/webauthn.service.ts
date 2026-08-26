import crypto from 'crypto';
import { env } from '../config/env';
import { MfaDeviceModel, MfaDevice } from '../models/mfa-device.model';
import { logger } from '../utils/logger.utils';

export interface PublicKeyCredentialCreationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout: number;
  attestation?: 'none' | 'direct' | 'indirect';
  authenticatorSelection?: {
    authenticatorAttachment?: 'platform' | 'cross-platform';
    requireResidentKey?: boolean;
    userVerification?: 'required' | 'preferred' | 'discouraged';
  };
  excludeCredentials?: {
    id: string;
    type: 'public-key';
    transports?: string[];
  }[];
}

export interface PublicKeyCredentialRequestOptions {
  challenge: string;
  timeout: number;
  rpId?: string;
  allowCredentials?: {
    id: string;
    type: 'public-key';
    transports?: string[];
  }[];
  userVerification?: 'required' | 'preferred' | 'discouraged';
}

export interface RegistrationCredential {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
}

export interface AuthenticationCredential {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
}

const RP_NAME = env.MFA_WEBAUTHN_RP_NAME || 'MentorMinds';
const RP_ID = env.MFA_WEBAUTHN_RP_ID || 'localhost';
const ORIGINS = (env.MFA_WEBAUTHN_ORIGINS || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map((o) => o.trim());
const TIMEOUT_MS = 60_000;
const CHALLENGE_TTL = 120;

const ES256_ALG = -7;
const RS256_ALG = -257;

function base64UrlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

function generateChallenge(): string {
  return base64UrlEncode(crypto.randomBytes(32));
}

interface ParsedClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

function parseClientDataJSON(base64Url: string): ParsedClientData {
  const buf = base64UrlDecode(base64Url);
  return JSON.parse(buf.toString('utf8'));
}

// ─── Minimal CBOR decoder ──────────────────────────────────────────────────
// Sufficient for decoding attestationObject (authData + fmt + attStmt) and
// extracting credential public key COSE_Key.

type CborValue =
  | null
  | boolean
  | number
  | string
  | Buffer
  | CborValue[]
  | Map<CborValue, CborValue>;

class CborDecoder {
  private buf: Buffer;
  private pos: number;

  constructor(buf: Buffer) {
    this.buf = buf;
    this.pos = 0;
  }

  readByte(): number {
    if (this.pos >= this.buf.length) throw new Error('CBOR: unexpected EOF');
    return this.buf[this.pos++];
  }

  readLength(major: number, addl: number): number {
    if (addl < 24) return addl;
    if (addl === 24) return this.readByte();
    if (addl === 25) return (this.readByte() << 8) | this.readByte();
    if (addl === 26) {
      let v = 0;
      for (let i = 0; i < 4; i++) v = (v << 8) | this.readByte();
      return v >>> 0;
    }
    if (addl === 27) {
      let v = 0n;
      for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(this.readByte());
      return Number(v);
    }
    throw new Error(`CBOR: unsupported length for major ${major}`);
  }

  decode(): CborValue {
    const b = this.readByte();
    const major = b >> 5;
    const addl = b & 0x1f;
    switch (major) {
      case 0:
        return this.readLength(major, addl);
      case 1:
        return -1 - this.readLength(major, addl);
      case 2: {
        const len = this.readLength(major, addl);
        const start = this.pos;
        this.pos += len;
        if (this.pos > this.buf.length) throw new Error('CBOR: bytes EOF');
        return this.buf.slice(start, this.pos);
      }
      case 3: {
        const len = this.readLength(major, addl);
        const start = this.pos;
        this.pos += len;
        if (this.pos > this.buf.length) throw new Error('CBOR: string EOF');
        return this.buf.slice(start, this.pos).toString('utf8');
      }
      case 4: {
        const len = this.readLength(major, addl);
        const arr: CborValue[] = [];
        for (let i = 0; i < len; i++) arr.push(this.decode());
        return arr;
      }
      case 5: {
        const len = this.readLength(major, addl);
        const map = new Map<CborValue, CborValue>();
        for (let i = 0; i < len; i++) {
          const k = this.decode();
          const v = this.decode();
          map.set(k, v);
        }
        return map;
      }
      case 7: {
        if (addl === 22) return false;
        if (addl === 23) return true;
        if (addl === 22) return false;
        if (addl === 23) return true;
        if (addl === 25) {
          this.pos += 2;
          return null;
        }
        if (addl === 26) {
          this.pos += 4;
          return null;
        }
        if (addl === 27) {
          this.pos += 8;
          return null;
        }
        return null;
      }
    }
    throw new Error(`CBOR: unknown major ${major}`);
  }
}

function decodeCbor(buf: Buffer): CborValue {
  return new CborDecoder(buf).decode();
}

interface AttestationObject {
  fmt: string;
  attStmt: Map<CborValue, CborValue>;
  authData: Buffer;
}

function parseAttestationObject(buf: Buffer): AttestationObject {
  const obj = decodeCbor(buf);
  if (!(obj instanceof Map)) throw new Error('attestationObject not a map');
  const fmt = obj.get('fmt' as any);
  const attStmt = obj.get('attStmt' as any);
  const authData = obj.get('authData' as any);
  if (typeof fmt !== 'string') throw new Error('attestation fmt missing');
  if (!(attStmt instanceof Map)) throw new Error('attStmt missing');
  if (!(authData instanceof Buffer)) throw new Error('authData missing');
  return { fmt, attStmt, authData };
}

interface AuthenticatorData {
  rpIdHash: Buffer;
  flags: number;
  signCount: number;
  attestedCredentialData?: AttestedCredentialData;
  extensions?: Map<CborValue, CborValue>;
}

interface AttestedCredentialData {
  aaguid: Buffer;
  credentialIdLength: number;
  credentialId: Buffer;
  credentialPublicKey: Map<CborValue, CborValue>;
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;
const FLAG_ED = 0x80;

function parseAuthenticatorData(buf: Buffer): AuthenticatorData {
  if (buf.length < 37) throw new Error('authData too short');
  let pos = 0;
  const rpIdHash = buf.slice(pos, pos + 32);
  pos += 32;
  const flags = buf[pos++];
  const signCount = buf.readUInt32BE(pos);
  pos += 4;
  const result: AuthenticatorData = { rpIdHash, flags, signCount };
  if (flags & FLAG_AT) {
    if (buf.length < pos + 16 + 2) throw new Error('authData attested missing');
    const aaguid = buf.slice(pos, pos + 16);
    pos += 16;
    const credentialIdLength = buf.readUInt16BE(pos);
    pos += 2;
    if (buf.length < pos + credentialIdLength) throw new Error('credentialId truncated');
    const credentialId = buf.slice(pos, pos + credentialIdLength);
    pos += credentialIdLength;
    const pubkeyDecoded = decodeCbor(buf.slice(pos));
    if (!(pubkeyDecoded instanceof Map)) throw new Error('COSE_Key not a map');
    result.attestedCredentialData = {
      aaguid,
      credentialIdLength,
      credentialId,
      credentialPublicKey: pubkeyDecoded,
    };
    // Advance pos past CBOR-encoded key (we simply re-decode from pos; approximate advance not needed)
    pos = buf.length;
  }
  if (flags & FLAG_ED && pos < buf.length) {
    const ext = decodeCbor(buf.slice(pos));
    if (ext instanceof Map) result.extensions = ext;
  }
  return result;
}

function coseToJwk(coseKey: Map<CborValue, CborValue>): { jwk: JsonWebKey; alg: number } {
  const kty = coseKey.get(1 as any);
  const alg = coseKey.get(3 as any);
  if (typeof kty !== 'number' || typeof alg !== 'number') {
    throw new Error('Invalid COSE key: kty/alg missing');
  }
  if (kty === 2 && alg === ES256_ALG) {
    const crv = coseKey.get(-1 as any);
    const x = coseKey.get(-2 as any);
    const y = coseKey.get(-3 as any);
    if (!(x instanceof Buffer) || !(y instanceof Buffer)) throw new Error('ES256 x/y missing');
    const crvName = crv === 1 ? 'P-256' : crv === 2 ? 'P-384' : crv === 3 ? 'P-521' : undefined;
    if (!crvName) throw new Error(`Unknown EC crv ${crv}`);
    return {
      alg,
      jwk: {
        kty: 'EC',
        crv: crvName,
        x: base64UrlEncode(x),
        y: base64UrlEncode(y),
      },
    };
  }
  if (kty === 3 && alg === RS256_ALG) {
    const n = coseKey.get(-1 as any);
    const e = coseKey.get(-2 as any);
    if (!(n instanceof Buffer) || !(e instanceof Buffer)) throw new Error('RSA n/e missing');
    return {
      alg,
      jwk: {
        kty: 'RSA',
        n: base64UrlEncode(n),
        e: base64UrlEncode(e),
      },
    };
  }
  throw new Error(`Unsupported COSE kty=${kty} alg=${alg}`);
}

function verifySignature(
  publicKeyJwk: JsonWebKey,
  alg: number,
  signature: Buffer,
  data: Buffer,
): boolean {
  try {
    if (alg === ES256_ALG) {
      const key = crypto.createPublicKey({ format: 'jwk', key: publicKeyJwk as any });
      return crypto.verify('sha256', data, key, signature);
    }
    if (alg === RS256_ALG) {
      const key = crypto.createPublicKey({ format: 'jwk', key: publicKeyJwk as any });
      return crypto.verify('sha256', data, key, signature);
    }
  } catch (err: any) {
    logger.warn('WebAuthn signature verification error', { error: err.message });
  }
  return false;
}

function aaguidToUuid(buf: Buffer): string {
  if (buf.length !== 16) return '';
  const hex = buf.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ─── Service API ───────────────────────────────────────────────────────────

export const WebAuthnService = {
  RP_NAME,
  RP_ID,
  ORIGINS,

  // ── Registration (Attestation) ──────────────────────────────────────────

  async generateRegistrationOptions(params: {
    userId: string;
    userName: string;
    userDisplayName: string;
    authenticatorAttachment?: 'platform' | 'cross-platform';
    userVerification?: 'required' | 'preferred' | 'discouraged';
  }): Promise<PublicKeyCredentialCreationOptions> {
    const challenge = generateChallenge();

    await MfaDeviceModel.storeChallenge({
      userId: params.userId,
      challenge,
      type: 'webauthn_register',
      payload: {
        userId: params.userId,
        userName: params.userName,
        userDisplayName: params.userDisplayName,
      },
      ttlSeconds: CHALLENGE_TTL,
    });

    const existingDevices = await MfaDeviceModel.listByUserAndType(params.userId, 'webauthn');
    const excludeCredentials = existingDevices
      .filter((d) => d.credential_id)
      .map((d) => ({
        id: base64UrlEncode(d.credential_id!),
        type: 'public-key' as const,
        transports: d.credential_transports || undefined,
      }));

    return {
      challenge,
      rp: { id: RP_ID, name: RP_NAME },
      user: {
        id: base64UrlEncode(Buffer.from(params.userId)),
        name: params.userName,
        displayName: params.userDisplayName,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: ES256_ALG },
        { type: 'public-key', alg: RS256_ALG },
      ],
      timeout: TIMEOUT_MS,
      attestation: 'none',
      authenticatorSelection: {
        authenticatorAttachment: params.authenticatorAttachment,
        userVerification: params.userVerification || 'preferred',
        requireResidentKey: false,
      },
      excludeCredentials,
    };
  },

  async verifyRegistration(params: {
    userId: string;
    credential: RegistrationCredential;
    deviceName?: string;
  }): Promise<{ device: MfaDevice } | { error: string }> {
    const { credential, userId, deviceName } = params;

    try {
      const clientData = parseClientDataJSON(credential.response.clientDataJSON);
      if (clientData.type !== 'webauthn.create') {
        return { error: 'Invalid clientData type' };
      }

      const challengeRecord = await MfaDeviceModel.getAndConsumeChallenge(
        clientData.challenge,
        'webauthn_register',
      );
      if (!challengeRecord) {
        return { error: 'Invalid or expired challenge' };
      }
      if (challengeRecord.user_id && challengeRecord.user_id !== userId) {
        return { error: 'Challenge does not match user' };
      }

      if (!ORIGINS.includes(clientData.origin)) {
        return { error: 'Invalid origin' };
      }

      const attestationObject = parseAttestationObject(
        base64UrlDecode(credential.response.attestationObject),
      );
      const authData = parseAuthenticatorData(attestationObject.authData);

      if (authData.rpIdHash.toString('hex') !== crypto.createHash('sha256').update(RP_ID).digest('hex')) {
        return { error: 'RP ID hash mismatch' };
      }
      if (!(authData.flags & FLAG_UP)) {
        return { error: 'User presence not verified' };
      }
      if (!authData.attestedCredentialData) {
        return { error: 'Attested credential data missing' };
      }

      const { attestedCredentialData } = authData;
      const credentialId = attestedCredentialData.credentialId;

      // Verify credentialId matches
      if (base64UrlEncode(credentialId) !== credential.id) {
        return { error: 'Credential ID mismatch' };
      }

      const { jwk, alg } = coseToJwk(attestedCredentialData.credentialPublicKey);

      // Encode public key JWK to Buffer (JSON bytes) for storage
      const publicKeyBytes = Buffer.from(JSON.stringify(jwk), 'utf8');

      const existing = await MfaDeviceModel.findWebAuthnByCredentialId(credentialId);
      if (existing) {
        return { error: 'Credential already registered' };
      }

      const device = await MfaDeviceModel.createWebAuthn({
        userId,
        name: deviceName,
        credentialId,
        credentialPublicKey: publicKeyBytes,
        credentialTransports: credential.response.transports,
        aaguid: aaguidToUuid(attestedCredentialData.aaguid) || undefined,
        signCount: authData.signCount,
      });

      return { device };
    } catch (err: any) {
      logger.warn('WebAuthn registration verification failed', { error: err.message });
      return { error: 'Registration verification failed' };
    }
  },

  // ── Authentication (Assertion) ──────────────────────────────────────────

  async generateAuthenticationOptions(params: {
    userId: string;
    userVerification?: 'required' | 'preferred' | 'discouraged';
  }): Promise<PublicKeyCredentialRequestOptions> {
    const challenge = generateChallenge();

    await MfaDeviceModel.storeChallenge({
      userId: params.userId,
      challenge,
      type: 'webauthn_authenticate',
      payload: { userId: params.userId },
      ttlSeconds: CHALLENGE_TTL,
    });

    const devices = await MfaDeviceModel.listByUserAndType(params.userId, 'webauthn');
    const allowCredentials = devices
      .filter((d) => d.credential_id)
      .map((d) => ({
        id: base64UrlEncode(d.credential_id!),
        type: 'public-key' as const,
        transports: d.credential_transports || undefined,
      }));

    return {
      challenge,
      timeout: TIMEOUT_MS,
      rpId: RP_ID,
      allowCredentials,
      userVerification: params.userVerification || 'preferred',
    };
  },

  async verifyAuthentication(params: {
    userId: string;
    credential: AuthenticationCredential;
  }): Promise<{ success: boolean; device?: MfaDevice; newSignCount?: number; error?: string }> {
    const { credential, userId } = params;

    try {
      const clientData = parseClientDataJSON(credential.response.clientDataJSON);
      if (clientData.type !== 'webauthn.get') {
        return { success: false, error: 'Invalid clientData type' };
      }

      const challengeRecord = await MfaDeviceModel.getAndConsumeChallenge(
        clientData.challenge,
        'webauthn_authenticate',
      );
      if (!challengeRecord) {
        return { success: false, error: 'Invalid or expired challenge' };
      }
      if (challengeRecord.user_id && challengeRecord.user_id !== userId) {
        return { success: false, error: 'Challenge does not match user' };
      }
      if (!ORIGINS.includes(clientData.origin)) {
        return { success: false, error: 'Invalid origin' };
      }

      const credentialId = base64UrlDecode(credential.id);
      const device = await MfaDeviceModel.findWebAuthnByCredentialId(credentialId);
      if (!device || device.user_id !== userId) {
        return { success: false, error: 'Unknown credential' };
      }
      if (!device.credential_public_key) {
        return { success: false, error: 'Device missing public key' };
      }

      // Parse stored public key
      const jwk: JsonWebKey = JSON.parse(device.credential_public_key.toString('utf8'));
      const alg = jwk.kty === 'EC' ? ES256_ALG : RS256_ALG;

      const authenticatorDataBuf = base64UrlDecode(credential.response.authenticatorData);
      const authData = parseAuthenticatorData(authenticatorDataBuf);

      if (authData.rpIdHash.toString('hex') !== crypto.createHash('sha256').update(RP_ID).digest('hex')) {
        return { success: false, error: 'RP ID hash mismatch' };
      }
      if (!(authData.flags & FLAG_UP)) {
        return { success: false, error: 'User presence not verified' };
      }

      // Build signed-over bytes: authenticatorData || sha256(clientDataJSON)
      const clientDataJsonBuf = base64UrlDecode(credential.response.clientDataJSON);
      const clientDataHash = crypto.createHash('sha256').update(clientDataJsonBuf).digest();
      const signedOver = Buffer.concat([authenticatorDataBuf, clientDataHash]);

      const signature = base64UrlDecode(credential.response.signature);
      if (!verifySignature(jwk, alg, signature, signedOver)) {
        return { success: false, error: 'Invalid signature' };
      }

      // Sign count check
      if (authData.signCount > 0 && authData.signCount <= device.sign_count) {
        return { success: false, error: 'Sign count too low — possible cloned authenticator' };
      }
      const newSignCount = authData.signCount || device.sign_count + 1;
      await MfaDeviceModel.updateSignCount(device.id, newSignCount);

      return { success: true, device, newSignCount };
    } catch (err: any) {
      logger.warn('WebAuthn authentication verification failed', { error: err.message });
      return { success: false, error: 'Authentication verification failed' };
    }
  },
};
