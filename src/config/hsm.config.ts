/**
 * HSM Configuration
 *
 * Configuration for Hardware Security Module (HSM) integration targeting
 * FIPS 140-2 Level 3 compliance.
 *
 * Provider selection (HSM_PROVIDER env var):
 *   "pkcs11"    — Real HSM via PKCS#11 (Thales Luna, AWS CloudHSM, etc.)
 *   "aws_cloudhsm" — AWS CloudHSM cluster (uses CloudHSM JCE SDK under the hood)
 *   "softhsm"   — SoftHSM2 (development / CI — NOT for production)
 *   "software"  — Pure software fallback (Node.js crypto, dev only)
 *
 * Key algorithms supported (FIPS 140-2 Level 3 approved):
 *   Symmetric  : AES-256 (CBC, GCM), AES-192, AES-128
 *   Asymmetric : RSA-2048, RSA-3072, RSA-4096, EC P-256, EC P-384, EC P-521
 *   Hash/HMAC  : SHA-256, SHA-384, SHA-512
 *   KDF        : HKDF, PBKDF2 (FIPS-approved with SHA-2)
 *
 * Key rotation policy:
 *   - Symmetric keys: rotated every 90 days (configurable via HSM_KEY_ROTATION_DAYS)
 *   - Asymmetric keys: rotated every 365 days
 *   - Emergency rotation: immediate via API trigger
 *
 * Key escrow:
 *   Encrypted key backups are stored in HSM_ESCROW_STORE (default: aws_secrets)
 *   and require M-of-N custodians for recovery (HSM_ESCROW_THRESHOLD).
 */

// ─── Provider ────────────────────────────────────────────────────────────────

export type HsmProvider = "pkcs11" | "aws_cloudhsm" | "softhsm" | "software";

export type HsmKeyAlgorithm =
  | "AES-256"
  | "AES-192"
  | "AES-128"
  | "RSA-2048"
  | "RSA-3072"
  | "RSA-4096"
  | "EC-P256"
  | "EC-P384"
  | "EC-P521";

export type HsmKeyUsage =
  | "encrypt"
  | "decrypt"
  | "sign"
  | "verify"
  | "wrap"
  | "unwrap"
  | "derive";

export type EscrowStore = "aws_secrets" | "vault" | "database" | "none";

// ─── PKCS#11 slot configuration ──────────────────────────────────────────────

export interface Pkcs11Config {
  /** Path to the PKCS#11 shared library (.so / .dylib / .dll) */
  libraryPath: string;
  /** HSM slot index or slot ID */
  slot: number;
  /** User PIN for normal-user authentication to the token */
  userPin: string;
  /** SO PIN (Security Officer) — used only for administrative operations */
  soPin?: string;
  /** Token label to identify the HSM partition */
  tokenLabel?: string;
  /** Read-only session if true (no key generation on this handle) */
  readOnly?: boolean;
  /** Maximum number of concurrent sessions */
  maxSessions?: number;
}

// ─── AWS CloudHSM configuration ──────────────────────────────────────────────

export interface AwsCloudHsmConfig {
  /** Cluster ID for the AWS CloudHSM cluster */
  clusterId: string;
  /** AWS region of the CloudHSM cluster */
  region: string;
  /** CloudHSM user credentials */
  cryptoUser: string;
  cryptoUserPassword: string;
  /** Path to customer CA certificate for CloudHSM TLS */
  customerCaCertPath?: string;
  /** Maximum concurrent HSM operations */
  maxConcurrency?: number;
}

// ─── SoftHSM2 configuration (development only) ───────────────────────────────

export interface SoftHsmConfig {
  /** Path to libsofthsm2.so */
  libraryPath: string;
  /** Slot / token for SoftHSM2 */
  slot: number;
  userPin: string;
  soPin?: string;
  tokenLabel?: string;
}

// ─── Key rotation policy ─────────────────────────────────────────────────────

export interface KeyRotationPolicy {
  /** Symmetric key rotation period in days (default: 90) */
  symmetricRotationDays: number;
  /** Asymmetric key rotation period in days (default: 365) */
  asymmetricRotationDays: number;
  /** Whether to auto-rotate on schedule */
  autoRotate: boolean;
  /** Grace period in days before old key version is purged after rotation */
  retentionDays: number;
  /** Maximum number of key versions to retain simultaneously */
  maxKeyVersions: number;
  /** Notify via event/webhook when rotation occurs */
  notifyOnRotation: boolean;
}

// ─── Key escrow configuration ─────────────────────────────────────────────────

export interface KeyEscrowConfig {
  /** Where to persist encrypted key backups */
  store: EscrowStore;
  /** M-of-N: minimum custodians required to recover the key */
  threshold: number;
  /** Total number of custodian shares to generate */
  totalShares: number;
  /** Encrypt escrow shares with custodian public keys (list of PEM strings) */
  custodianPublicKeys: string[];
  /** AWS Secrets Manager ARN or path prefix (when store === 'aws_secrets') */
  awsSecretPrefix?: string;
  /** Vault path prefix (when store === 'vault') */
  vaultPathPrefix?: string;
}

// ─── Compliance & audit ───────────────────────────────────────────────────────

export interface HsmComplianceConfig {
  /** FIPS 140-2 validation level target (informational) */
  fipsLevel: 1 | 2 | 3 | 4;
  /** Log every cryptographic operation to the audit trail */
  auditAllOperations: boolean;
  /** Retain audit log entries for N days */
  auditRetentionDays: number;
  /** Generate monthly compliance reports */
  monthlyReportEnabled: boolean;
  /** PKCS#11 mechanism allow-list (empty = all mechanisms) */
  allowedMechanisms: string[];
}

// ─── Main HSM config interface ────────────────────────────────────────────────

export interface HsmConfig {
  /** Selected HSM provider */
  provider: HsmProvider;
  /** Whether the HSM integration is enabled */
  enabled: boolean;
  /** PKCS#11 config (required when provider = 'pkcs11' | 'softhsm') */
  pkcs11?: Pkcs11Config;
  /** AWS CloudHSM config (required when provider = 'aws_cloudhsm') */
  awsCloudHsm?: AwsCloudHsmConfig;
  /** SoftHSM config (alias of pkcs11 for dev convenience) */
  softHsm?: SoftHsmConfig;
  /** Key rotation policy */
  rotation: KeyRotationPolicy;
  /** Key escrow & recovery configuration */
  escrow: KeyEscrowConfig;
  /** Compliance & audit settings */
  compliance: HsmComplianceConfig;
  /** Default algorithm for new symmetric keys */
  defaultSymmetricAlgorithm: HsmKeyAlgorithm;
  /** Default algorithm for new asymmetric keys */
  defaultAsymmetricAlgorithm: HsmKeyAlgorithm;
  /** Connection / operation timeout in milliseconds */
  timeoutMs: number;
  /** Number of retries on transient HSM failures */
  maxRetries: number;
  /** Delay between retries in milliseconds */
  retryDelayMs: number;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Build the HSM configuration from environment variables.
 * All secrets (PINs, passwords) are read at call-time so they can be
 * injected by the secrets loader before this module is evaluated.
 */
export function buildHsmConfig(): HsmConfig {
  const provider = (process.env.HSM_PROVIDER ?? "software") as HsmProvider;
  const enabled = process.env.HSM_ENABLED !== "false" && provider !== "software";

  // ── PKCS#11 / SoftHSM ──
  const pkcs11: Pkcs11Config | undefined =
    provider === "pkcs11" || provider === "softhsm"
      ? {
          libraryPath:
            process.env.HSM_PKCS11_LIBRARY_PATH ??
            (provider === "softhsm"
              ? "/usr/lib/softhsm/libsofthsm2.so"
              : "/usr/lib/libCryptoki2_64.so"),
          slot: parseInt(process.env.HSM_PKCS11_SLOT ?? "0", 10),
          userPin: process.env.HSM_PKCS11_USER_PIN ?? "",
          soPin: process.env.HSM_PKCS11_SO_PIN,
          tokenLabel: process.env.HSM_TOKEN_LABEL ?? "MentorMindsHSM",
          readOnly: process.env.HSM_PKCS11_READ_ONLY === "true",
          maxSessions: parseInt(
            process.env.HSM_PKCS11_MAX_SESSIONS ?? "10",
            10,
          ),
        }
      : undefined;

  // ── AWS CloudHSM ──
  const awsCloudHsm: AwsCloudHsmConfig | undefined =
    provider === "aws_cloudhsm"
      ? {
          clusterId: process.env.HSM_AWS_CLUSTER_ID ?? "",
          region: process.env.HSM_AWS_REGION ?? process.env.AWS_REGION ?? "us-east-1",
          cryptoUser: process.env.HSM_AWS_CRYPTO_USER ?? "",
          cryptoUserPassword: process.env.HSM_AWS_CRYPTO_USER_PASSWORD ?? "",
          customerCaCertPath: process.env.HSM_AWS_CA_CERT_PATH,
          maxConcurrency: parseInt(
            process.env.HSM_AWS_MAX_CONCURRENCY ?? "20",
            10,
          ),
        }
      : undefined;

  // ── Rotation policy ──
  const rotation: KeyRotationPolicy = {
    symmetricRotationDays: parseInt(
      process.env.HSM_KEY_ROTATION_DAYS ?? "90",
      10,
    ),
    asymmetricRotationDays: parseInt(
      process.env.HSM_ASYMMETRIC_KEY_ROTATION_DAYS ?? "365",
      10,
    ),
    autoRotate: process.env.HSM_AUTO_ROTATE !== "false",
    retentionDays: parseInt(process.env.HSM_KEY_RETENTION_DAYS ?? "30", 10),
    maxKeyVersions: parseInt(process.env.HSM_MAX_KEY_VERSIONS ?? "5", 10),
    notifyOnRotation: process.env.HSM_NOTIFY_ON_ROTATION !== "false",
  };

  // ── Escrow config ──
  const escrow: KeyEscrowConfig = {
    store: (process.env.HSM_ESCROW_STORE ?? "aws_secrets") as EscrowStore,
    threshold: parseInt(process.env.HSM_ESCROW_THRESHOLD ?? "2", 10),
    totalShares: parseInt(process.env.HSM_ESCROW_TOTAL_SHARES ?? "3", 10),
    custodianPublicKeys: process.env.HSM_ESCROW_CUSTODIAN_KEYS
      ? process.env.HSM_ESCROW_CUSTODIAN_KEYS.split(",").map((k) => k.trim())
      : [],
    awsSecretPrefix:
      process.env.HSM_ESCROW_AWS_SECRET_PREFIX ?? "mentorminds/hsm/escrow/",
    vaultPathPrefix:
      process.env.HSM_ESCROW_VAULT_PATH_PREFIX ?? "secret/mentorminds/hsm/escrow/",
  };

  // ── Compliance config ──
  const compliance: HsmComplianceConfig = {
    fipsLevel: (parseInt(process.env.HSM_FIPS_LEVEL ?? "3", 10) as 1 | 2 | 3 | 4),
    auditAllOperations: process.env.HSM_AUDIT_ALL_OPS !== "false",
    auditRetentionDays: parseInt(
      process.env.HSM_AUDIT_RETENTION_DAYS ?? "2555",
      10,
    ), // 7 years
    monthlyReportEnabled: process.env.HSM_MONTHLY_REPORT !== "false",
    // FIPS 140-2 Level 3 approved mechanisms
    allowedMechanisms: process.env.HSM_ALLOWED_MECHANISMS
      ? process.env.HSM_ALLOWED_MECHANISMS.split(",").map((m) => m.trim())
      : [
          "AES-GCM",
          "AES-CBC",
          "AES-CBC-PAD",
          "AES-KEY-WRAP",
          "RSA-PKCS",
          "RSA-PKCS-OAEP",
          "RSA-PKCS-PSS",
          "SHA256-RSA-PKCS",
          "SHA384-RSA-PKCS",
          "SHA512-RSA-PKCS",
          "SHA256-RSA-PKCS-PSS",
          "ECDSA",
          "ECDSA-SHA256",
          "ECDSA-SHA384",
          "ECDSA-SHA512",
          "AES-CMAC",
          "SHA256-HMAC",
          "SHA384-HMAC",
          "SHA512-HMAC",
          "GENERIC-SECRET-KEY-GEN",
          "AES-KEY-GEN",
          "RSA-PKCS-KEY-PAIR-GEN",
          "EC-KEY-PAIR-GEN",
        ],
  };

  return {
    provider,
    enabled,
    pkcs11,
    awsCloudHsm,
    softHsm: provider === "softhsm" && pkcs11 ? { ...pkcs11 } : undefined,
    rotation,
    escrow,
    compliance,
    defaultSymmetricAlgorithm: "AES-256",
    defaultAsymmetricAlgorithm: "RSA-3072",
    timeoutMs: parseInt(process.env.HSM_TIMEOUT_MS ?? "5000", 10),
    maxRetries: parseInt(process.env.HSM_MAX_RETRIES ?? "3", 10),
    retryDelayMs: parseInt(process.env.HSM_RETRY_DELAY_MS ?? "500", 10),
  };
}

/** Singleton HSM configuration — resolved once at startup. */
export const hsmConfig: HsmConfig = buildHsmConfig();
export default hsmConfig;
