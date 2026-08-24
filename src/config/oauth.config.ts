// Single source of truth for OAuth2 provider configuration.
// Other code (services, controllers) should query this module instead of
// hardcoding provider lists or credential checks.

export type OAuthProviderName = 'google' | 'github' | 'linkedin' | 'microsoft';

export interface OAuthProviderConfig {
    name: OAuthProviderName;
    scopes: string[];
    authorizationURL: string | null; // null for providers using dedicated passport strategies (google/github)
    tokenURL: string | null;
    userInfoURL: string | null;
    clientId: string | undefined;
    clientSecret: string | undefined;
    callbackURL: string;
    enabled: boolean;
}

const oauthConfig: Record<OAuthProviderName, OAuthProviderConfig> = {
    google: {
        name: 'google',
        scopes: ['profile', 'email'],
        authorizationURL: null,
        tokenURL: null,
        userInfoURL: null,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/v1/auth/google/callback',
        enabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
    github: {
        name: 'github',
        scopes: ['user:email'],
        authorizationURL: null,
        tokenURL: null,
        userInfoURL: null,
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: process.env.GITHUB_CALLBACK_URL || '/api/v1/auth/github/callback',
        enabled: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    },
    linkedin: {
        name: 'linkedin',
        scopes: ['openid', 'profile', 'email'],
        authorizationURL: 'https://www.linkedin.com/oauth/v2/authorization',
        tokenURL: 'https://www.linkedin.com/oauth/v2/accessToken',
        userInfoURL: 'https://api.linkedin.com/v2/userinfo',
        clientId: process.env.LINKEDIN_CLIENT_ID,
        clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
        callbackURL: process.env.LINKEDIN_CALLBACK_URL || '/api/v1/auth/linkedin/callback',
        enabled: Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
    },
    microsoft: {
        name: 'microsoft',
        scopes: ['openid', 'profile', 'email', 'User.Read'],
        authorizationURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        userInfoURL: 'https://graph.microsoft.com/v1.0/me',
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        callbackURL: process.env.MICROSOFT_CALLBACK_URL || '/api/v1/auth/microsoft/callback',
        enabled: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
    },
};

export default oauthConfig;
