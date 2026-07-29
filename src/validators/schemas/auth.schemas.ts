/**
 * Auth Validation Schemas
 * Zod schemas for all authentication endpoints.
 */

import { z } from 'zod';
import { emailSchema, passwordSchema, uuidSchema } from './common.schemas';

export const registerSchema = z.object({
    body: z.object({
        email: emailSchema,
        password: passwordSchema,
        firstName: z
            .string()
            .min(1, 'First name is required')
            .trim()
            .min(2, 'First name must be at least 2 characters')
            .max(100, 'First name must not exceed 100 characters'),
        lastName: z
            .string()
            .min(1, 'Last name is required')
            .trim()
            .min(2, 'Last name must be at least 2 characters')
            .max(100, 'Last name must not exceed 100 characters'),
        role: z.enum(['mentee', 'mentor'])
            .default('mentee'),
    }).strict(),
});

export const loginSchema = z.object({
    body: z.object({
        email: emailSchema,
        password: z.string().min(1, 'Password is required'),
    }).strict(),
});

export const refreshTokenSchema = z.object({
    body: z.object({
        refreshToken: z
            .string()
            .min(1, 'Refresh token is required'),
    }).strict(),
});

export const forgotPasswordSchema = z.object({
    body: z.object({
        email: emailSchema,
    }).strict(),
});

export const resetPasswordSchema = z.object({
    body: z.object({
        token: z.string().min(1, 'Reset token is required'),
        password: passwordSchema,
    }).strict(),
});

export const changePasswordSchema = z.object({
    body: z.object({
        currentPassword: z
            .string()
            .min(1, 'Current password is required'),
        newPassword: passwordSchema,
    }).strict(),
});

// ---------------------------------------------------------------------------
// MFA (TOTP) schemas
// ---------------------------------------------------------------------------

export const mfaVerifySetupSchema = z.object({
    body: z.object({
        token: z.string().trim().min(1, 'Token is required').max(20),
    }).strict(),
});

export const mfaDisableSchema = z.object({
    body: z.object({
        token: z.string().trim().min(1, 'Token is required').max(20),
    }).strict(),
});

export const mfaValidateSchema = z.object({
    body: z.object({
        mfaToken: z.string().trim().min(1, 'mfaToken is required').max(2000),
        otpToken: z.string().trim().min(1, 'otpToken is required').max(20),
    }).strict(),
});

export const mfaBackupSchema = z.object({
    body: z.object({
        mfaToken: z.string().trim().min(1, 'mfaToken is required').max(2000),
        backupCode: z.string().trim().min(1, 'backupCode is required').max(50),
    }).strict(),
});

// ---------------------------------------------------------------------------
// MFA OTP (SMS/email) schemas
// ---------------------------------------------------------------------------

export const mfaOtpSendSchema = z.object({
    body: z.object({
        method: z.enum(['sms', 'email']),
    }).strict(),
});

export const mfaOtpSetupSchema = z.object({
    body: z.object({
        method: z.enum(['sms', 'email']),
        code: z.string().trim().min(1, 'code is required').max(20),
        phone: z.string().trim().min(5).max(20).optional(),
    }).strict(),
});

export const mfaOtpValidateSchema = z.object({
    body: z.object({
        mfaToken: z.string().trim().min(1, 'mfaToken is required').max(2000),
        code: z.string().trim().min(1, 'code is required').max(20),
    }).strict(),
});

// ---------------------------------------------------------------------------
// Session management schemas
// ---------------------------------------------------------------------------

export const listAuthSessionsSchema = z.object({
    query: z.object({
        cursor: z.string().trim().max(500).optional(),
        limit: z
            .string()
            .optional()
            .transform((v) => (v ? parseInt(v, 10) : 20))
            .refine((v) => Number.isInteger(v) && v >= 1 && v <= 100, 'Limit must be between 1 and 100'),
    }),
});

export const revokeSessionParamSchema = z.object({
    params: z.object({ id: uuidSchema }),
});

// ---------------------------------------------------------------------------
// OAuth schemas
// ---------------------------------------------------------------------------

export const oauthProviderParamSchema = z.object({
    params: z.object({
        provider: z.enum(['google', 'github']),
    }),
});

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>['body'];
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>['body'];
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>['body'];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>['body'];
