import axios from "axios";
import { logger } from "../utils/logger.utils";

export interface PublicKey {
  id: string;
  type: string;
  controller: string;
  publicKeyBase58?: string;
  publicKeyJwk?: Record<string, unknown>;
}

export interface Proof {
  type: string;
  created: Date;
  verificationMethod: string;
  proofPurpose: string;
  jws: string;
}

export interface DIDDocument {
  "@context": string[];
  id: string;
  verificationMethod: PublicKey[];
  authentication: string[];
  assertionMethod: string[];
  service?: Array<{ id: string; type: string; serviceEndpoint: string }>;
}

export interface VerifiableCredential {
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: Date;
  expirationDate?: Date;
  credentialSubject: Record<string, unknown>;
  proof: Proof;
}

export interface DecentralizedIdentity {
  did: string;
  document: DIDDocument;
  credentials: VerifiableCredential[];
  publicKeys: PublicKey[];
}

export class DIDService {
  private readonly stellarNetwork = process.env.STELLAR_NETWORK || "testnet";
  private readonly didRegistry = new Map<string, DecentralizedIdentity>();

  createDID(userId: string, publicKeyBase58: string): DecentralizedIdentity {
    const did = `did:stellar:${this.stellarNetwork}:${userId}`;
    const keyId = `${did}#key-1`;

    const publicKey: PublicKey = {
      id: keyId,
      type: "Ed25519VerificationKey2020",
      controller: did,
      publicKeyBase58,
    };

    const document: DIDDocument = {
      "@context": [
        "https://www.w3.org/ns/did/v1",
        "https://w3id.org/security/suites/ed25519-2020/v1",
      ],
      id: did,
      verificationMethod: [publicKey],
      authentication: [keyId],
      assertionMethod: [keyId],
    };

    const identity: DecentralizedIdentity = {
      did,
      document,
      credentials: [],
      publicKeys: [publicKey],
    };

    this.didRegistry.set(did, identity);
    logger.info(`DID created: ${did}`);
    return identity;
  }

  resolveDID(did: string): DecentralizedIdentity | null {
    const identity = this.didRegistry.get(did);
    if (!identity) {
      logger.warn(`DID not found: ${did}`);
      return null;
    }
    return identity;
  }

  issueCredential(
    issuerDid: string,
    subjectDid: string,
    type: string,
    credentialSubject: Record<string, unknown>,
    expirationDate?: Date,
  ): VerifiableCredential {
    const credential: VerifiableCredential = {
      id: `urn:uuid:${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: ["VerifiableCredential", type],
      issuer: issuerDid,
      issuanceDate: new Date(),
      expirationDate,
      credentialSubject: { id: subjectDid, ...credentialSubject },
      proof: {
        type: "Ed25519Signature2020",
        created: new Date(),
        verificationMethod: `${issuerDid}#key-1`,
        proofPurpose: "assertionMethod",
        jws: this.signCredential(issuerDid, credentialSubject),
      },
    };

    const identity = this.didRegistry.get(subjectDid);
    if (identity) {
      identity.credentials.push(credential);
    }

    logger.info(`Credential issued: ${credential.id} by ${issuerDid}`);
    return credential;
  }

  verifyCredential(credential: VerifiableCredential): boolean {
    if (credential.expirationDate && new Date() > credential.expirationDate) {
      logger.warn(`Credential ${credential.id} has expired`);
      return false;
    }

    const issuerIdentity = this.didRegistry.get(credential.issuer);
    if (!issuerIdentity) {
      logger.warn(`Issuer DID not found: ${credential.issuer}`);
      return false;
    }

    // Verify proof exists and issuer is valid
    const isValid =
      !!credential.proof.jws &&
      credential.proof.verificationMethod.startsWith(credential.issuer);

    logger.info(`Credential ${credential.id} verification: ${isValid}`);
    return isValid;
  }

  getCredentials(did: string): VerifiableCredential[] {
    return this.didRegistry.get(did)?.credentials ?? [];
  }

  async resolveExternalDID(did: string): Promise<DIDDocument | null> {
    try {
      const response = await axios.get(
        `https://resolver.identity.foundation/1.0/identifiers/${encodeURIComponent(did)}`,
      );
      return response.data.didDocument ?? null;
    } catch (err) {
      logger.error(`Failed to resolve external DID ${did}`, err);
      return null;
    }
  }

  private signCredential(
    issuerDid: string,
    payload: Record<string, unknown>,
  ): string {
    // Stub: in production, sign with issuer's private key
    const data = JSON.stringify({ issuer: issuerDid, payload });
    return Buffer.from(data).toString("base64");
  }
}

export const didService = new DIDService();
