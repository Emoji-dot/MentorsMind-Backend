import { cache } from '../config/cache';
import { logger } from '../utils/logger';

export interface DomainHealth {
  domain: string;
  healthy: boolean;
  latencyMs: number;
  lastChecked: string;
  failureCount?: number;
  circuitOpen?: boolean;
}

export interface CDNHealthMetrics {
  [domain: string]: DomainHealth;
}

const HEALTH_CHECK_TIMEOUT = 5000; // 5 seconds
const CIRCUIT_BREAKER_THRESHOLD = 3; // 3 consecutive failures
const CIRCUIT_BREAKER_COOLDOWN = 5 * 60 * 1000; // 5 minutes
const HEALTH_CHECK_INTERVAL = 60 * 1000; // 60 seconds

/**
 * CDNHealthService monitors the health of CDN domains through lightweight HEAD requests.
 * It maintains a circuit breaker per provider and stores health metrics in Redis.
 */
export class CDNHealthService {
  /**
   * Check if a single CDN domain is healthy by making a HEAD request.
   * Measures response time and updates Redis cache.
   */
  static async checkHealth(domain: string): Promise<DomainHealth> {
    const redisKey = `cdn:health:${domain}`;
    const failureKey = `cdn:health:${domain}:failures`;
    const circuitKey = `cdn:health:${domain}:circuit`;
    const circuitOpenedAtKey = `cdn:health:${domain}:circuit_opened_at`;

    const startTime = Date.now();
    let healthy = false;
    let latencyMs = 0;

    try {
      // Check if circuit is open
      const circuitOpenedAt = await cache.get(circuitOpenedAtKey);
      if (circuitOpenedAt) {
        const openedAtTime = parseInt(circuitOpenedAt as string, 10);
        const timeSinceOpen = Date.now() - openedAtTime;
        
        if (timeSinceOpen < CIRCUIT_BREAKER_COOLDOWN) {
          logger.warn(`CDN health check: circuit breaker open for ${domain}`, {
            domain,
            timeSinceOpen,
            cooldownMs: CIRCUIT_BREAKER_COOLDOWN,
          });

          const health: DomainHealth = {
            domain,
            healthy: false,
            latencyMs: 0,
            lastChecked: new Date().toISOString(),
            circuitOpen: true,
          };

          await cache.set(redisKey, JSON.stringify(health), 60); // Store for 60s
          return health;
        } else {
          // Circuit cooldown expired, try to close it
          await cache.delete(circuitOpenedAtKey);
        }
      }

      // Make HEAD request to health-check endpoint
      const response = await fetch(`${domain}/health-check-asset.txt`, {
        method: 'HEAD',
        timeout: HEALTH_CHECK_TIMEOUT,
      });

      latencyMs = Date.now() - startTime;
      healthy = response.ok && response.status >= 200 && response.status < 300;

      // Reset failure count on successful check
      if (healthy) {
        await cache.delete(failureKey);
      } else {
        // Increment failure count
        const failureCount = parseInt((await cache.get(failureKey)) as string, 10) || 0;
        const newFailureCount = failureCount + 1;
        await cache.set(failureKey, newFailureCount.toString(), CIRCUIT_BREAKER_COOLDOWN);

        // Open circuit if threshold reached
        if (newFailureCount >= CIRCUIT_BREAKER_THRESHOLD) {
          await cache.set(circuitOpenedAtKey, Date.now().toString(), CIRCUIT_BREAKER_COOLDOWN);
          logger.error(`CDN health check: circuit breaker opened for ${domain}`, {
            domain,
            failureCount: newFailureCount,
            threshold: CIRCUIT_BREAKER_THRESHOLD,
          });
        }
      }

      logger.info(`CDN health check completed for ${domain}`, {
        domain,
        healthy,
        latencyMs,
        statusCode: response.status,
      });
    } catch (error) {
      latencyMs = Date.now() - startTime;
      healthy = false;

      // Increment failure count
      const failureCount = parseInt((await cache.get(failureKey)) as string, 10) || 0;
      const newFailureCount = failureCount + 1;
      await cache.set(failureKey, newFailureCount.toString(), CIRCUIT_BREAKER_COOLDOWN);

      // Open circuit if threshold reached
      if (newFailureCount >= CIRCUIT_BREAKER_THRESHOLD) {
        await cache.set(circuitOpenedAtKey, Date.now().toString(), CIRCUIT_BREAKER_COOLDOWN);
        logger.error(`CDN health check: circuit breaker opened for ${domain}`, {
          domain,
          failureCount: newFailureCount,
          threshold: CIRCUIT_BREAKER_THRESHOLD,
        });
      }

      logger.error(`CDN health check failed for ${domain}`, {
        domain,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs,
      });
    }

    const health: DomainHealth = {
      domain,
      healthy,
      latencyMs,
      lastChecked: new Date().toISOString(),
      circuitOpen: false,
    };

    // Store health info in Redis
    await cache.set(redisKey, JSON.stringify(health), 60); // Expire after 60s

    return health;
  }

  /**
   * Get the healthiest domain from a list.
   * Returns the fastest healthy domain, or the original domain if all are unhealthy.
   */
  static async getHealthiestDomain(domains: string[]): Promise<string> {
    if (!domains.length) {
      throw new Error('No domains provided');
    }

    const healthStates = await Promise.all(
      domains.map(async (domain) => {
        try {
          const redisKey = `cdn:health:${domain}`;
          const cached = await cache.get(redisKey);
          if (cached) {
            return JSON.parse(cached as string) as DomainHealth;
          }
          // If no cached data, do a health check now
          return this.checkHealth(domain);
        } catch (error) {
          logger.warn(`Failed to get health for domain ${domain}`, {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return {
            domain,
            healthy: false,
            latencyMs: Infinity,
            lastChecked: new Date().toISOString(),
          } as DomainHealth;
        }
      }),
    );

    // Filter healthy domains
    const healthyDomains = healthStates.filter((s) => s.healthy);

    if (healthyDomains.length > 0) {
      // Return the fastest healthy domain
      return healthyDomains.reduce((fastest, current) =>
        current.latencyMs < fastest.latencyMs ? current : fastest,
      ).domain;
    }

    // Fallback to first domain if all are unhealthy
    logger.warn('All CDN domains are unhealthy, falling back to first domain', {
      domains,
    });
    return domains[0];
  }

  /**
   * Get health status for all domains.
   */
  static async getHealthStatus(domains: string[]): Promise<CDNHealthMetrics> {
    const metrics: CDNHealthMetrics = {};

    for (const domain of domains) {
      try {
        const redisKey = `cdn:health:${domain}`;
        const cached = await cache.get(redisKey);
        if (cached) {
          metrics[domain] = JSON.parse(cached as string) as DomainHealth;
        } else {
          metrics[domain] = await this.checkHealth(domain);
        }
      } catch (error) {
        logger.error(`Failed to get health status for ${domain}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        metrics[domain] = {
          domain,
          healthy: false,
          latencyMs: 0,
          lastChecked: new Date().toISOString(),
        };
      }
    }

    return metrics;
  }

  /**
   * Clear health status for a domain (useful for manual recovery).
   */
  static async clearHealth(domain: string): Promise<void> {
    const redisKey = `cdn:health:${domain}`;
    const failureKey = `cdn:health:${domain}:failures`;
    const circuitOpenedAtKey = `cdn:health:${domain}:circuit_opened_at`;

    await Promise.all([
      cache.delete(redisKey),
      cache.delete(failureKey),
      cache.delete(circuitOpenedAtKey),
    ]);

    logger.info(`Cleared health status for ${domain}`, { domain });
  }
}

export default CDNHealthService;
