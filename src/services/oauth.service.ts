import oauthConfig, { OAuthProviderName } from '../config/oauth.config';

export const OAuthService = {
    /**
     * Returns the names of OAuth providers that are currently enabled
     * (i.e. have client id/secret configured via environment variables).
     */
    async listAvailableProviders(): Promise<OAuthProviderName[]> {
        return (Object.values(oauthConfig) as (typeof oauthConfig)[OAuthProviderName][])
            .filter((provider) => provider.enabled)
            .map((provider) => provider.name);
    },

    /**
     * Returns all provider names known to the system, regardless of whether
     * they are currently enabled. Useful for validating a `:provider` route
     * param against the full set of valid values.
     */
    getAllProviderNames(): OAuthProviderName[] {
        return Object.keys(oauthConfig) as OAuthProviderName[];
    },

    /**
     * Checks whether a given provider name is enabled (credentials configured).
     */
    async isProviderEnabled(provider: string): Promise<boolean> {
        const config = oauthConfig[provider as OAuthProviderName];
        return Boolean(config?.enabled);
    },
};
