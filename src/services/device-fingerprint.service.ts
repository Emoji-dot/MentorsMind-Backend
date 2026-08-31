import crypto from 'crypto';
import { Request } from 'express';
import { DeviceInfo, DeviceType, FingerprintComponents } from '../models/user-session.model';
import { env } from '../config/env';

const FINGERPRINT_SALT = env.SESSION_FINGERPRINT_SALT || 'mentorminds-session-fp-v1';
const FINGERPRINT_VERSION = 1;

function normalizeStr(s: string | null | undefined): string {
  return (s ?? '').toString().trim().toLowerCase();
}

function hashStable(input: string): string {
  return crypto
    .createHmac('sha256', FINGERPRINT_SALT)
    .update(`${FINGERPRINT_VERSION}|${input}`)
    .digest('hex');
}

// ─── UA Parsing (no-deps, regex-based) ─────────────────────────────────────

interface UaParseResult {
  browserName: string | null;
  browserVersion: string | null;
  osName: string | null;
  osVersion: string | null;
  deviceType: DeviceType;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isBot: boolean;
  platform: string | null;
}

function parseUserAgent(ua: string | null | undefined): UaParseResult {
  const input = ua ?? '';
  const result: UaParseResult = {
    browserName: null,
    browserVersion: null,
    osName: null,
    osVersion: null,
    deviceType: 'unknown',
    isMobile: false,
    isTablet: false,
    isDesktop: false,
    isBot: false,
    platform: null,
  };

  // Bots
  const botRe =
    /(bot|crawl|slurp|spider|mediapartners|facebookexternalhit|whatsapp|telegrambot|linkedinbot|pingdom|uptime|curl|wget|python-requests|scrapy|httpclient|java\/|node-fetch)/i;
  if (botRe.test(input)) {
    result.isBot = true;
    result.deviceType = 'bot';
  }

  // OS
  if (/Windows NT 10\.0/.test(input)) {
    result.osName = 'Windows';
    result.osVersion = '10';
  } else if (/Windows NT 6\.3/.test(input)) {
    result.osName = 'Windows';
    result.osVersion = '8.1';
  } else if (/Windows NT 6\.1/.test(input)) {
    result.osName = 'Windows';
    result.osVersion = '7';
  } else if (/Windows NT 6\.2/.test(input)) {
    result.osName = 'Windows';
    result.osVersion = '8';
  } else if (/Windows/.test(input)) {
    result.osName = 'Windows';
  } else if (/iPhone OS (\d+[_.]\d+)/.test(input)) {
    const m = input.match(/iPhone OS (\d+[_.]\d+)/);
    result.osName = 'iOS';
    result.osVersion = m ? m[1].replace('_', '.') : null;
  } else if (/CPU OS (\d+[_.]\d+)/.test(input)) {
    const m = input.match(/CPU OS (\d+[_.]\d+)/);
    result.osName = 'iOS';
    result.osVersion = m ? m[1].replace('_', '.') : null;
  } else if (/iPad.*OS (\d+[_.]\d+)/.test(input) || /CPU OS (\d+[_.]\d+).*Mac.*like Mac OS X/.test(input)) {
    const m = input.match(/OS (\d+[_.]\d+)/);
    result.osName = 'iPadOS';
    result.osVersion = m ? m[1].replace('_', '.') : null;
  } else if (/Mac OS X (\d+[_.]\d+[_.]?\d*)/.test(input)) {
    const m = input.match(/Mac OS X (\d+[_.]\d+[_.]?\d*)/);
    result.osName = 'macOS';
    result.osVersion = m ? m[1].replace(/_/g, '.') : null;
  } else if (/Android (\d+[.\d]*)/.test(input)) {
    const m = input.match(/Android (\d+[.\d]*)/);
    result.osName = 'Android';
    result.osVersion = m ? m[1] : null;
  } else if (/Android/.test(input)) {
    result.osName = 'Android';
  } else if (/Linux/.test(input)) {
    result.osName = 'Linux';
  } else if (/CrOS/.test(input)) {
    result.osName = 'ChromeOS';
  }

  // Browser
  if (/Edg\/([\d.]+)/.test(input)) {
    const m = input.match(/Edg\/([\d.]+)/);
    result.browserName = 'Edge';
    result.browserVersion = m ? m[1] : null;
  } else if (/OPR\/([\d.]+)/.test(input) || /Opera\/([\d.]+)/.test(input)) {
    const m = input.match(/(?:OPR|Opera)\/([\d.]+)/);
    result.browserName = 'Opera';
    result.browserVersion = m ? m[1] : null;
  } else if (/Brave\/([\d.]+)/.test(input)) {
    const m = input.match(/Brave\/([\d.]+)/);
    result.browserName = 'Brave';
    result.browserVersion = m ? m[1] : null;
  } else if (/Chrome\/([\d.]+)/.test(input) && !/Edg\//.test(input)) {
    const m = input.match(/Chrome\/([\d.]+)/);
    result.browserName = 'Chrome';
    result.browserVersion = m ? m[1] : null;
  } else if (/Firefox\/([\d.]+)/.test(input)) {
    const m = input.match(/Firefox\/([\d.]+)/);
    result.browserName = 'Firefox';
    result.browserVersion = m ? m[1] : null;
  } else if (/Safari\/([\d.]+)/.test(input) && !/Chrome\//.test(input)) {
    const m = input.match(/Safari\/([\d.]+)/);
    result.browserName = 'Safari';
    result.browserVersion = m ? m[1] : null;
  } else if (/MSIE (\d+[.\d]*)/.test(input) || /Trident.*rv:(\d+[.\d]*)/.test(input)) {
    const m = input.match(/(?:MSIE |rv:)(\d+[.\d]*)/);
    result.browserName = 'IE';
    result.browserVersion = m ? m[1] : null;
  }

  // Platform hint
  if (/Win\d|Windows/.test(input)) result.platform = 'Windows';
  else if (/Mac OS X|iPhone|iPad|iOS|iPadOS/.test(input)) result.platform = 'Apple';
  else if (/Android|Linux/.test(input)) result.platform = 'Linux';
  else if (/CrOS/.test(input)) result.platform = 'ChromeOS';

  // Device type
  if (/iPad|Tablet|PlayBook|TouchPad|Silk\//.test(input)) {
    result.isTablet = true;
    result.deviceType = 'tablet';
  } else if (
    /iPhone|iPod|Android.*Mobile|Windows Phone|webOS|BlackBerry|Mobile/.test(input) ||
    /Mobile\//.test(input)
  ) {
    result.isMobile = true;
    result.deviceType = 'mobile';
  } else if (!result.isBot) {
    result.isDesktop = true;
    result.deviceType = 'desktop';
  }

  return result;
}

// ─── Geo IP lookup (provider abstraction) ──────────────────────────────────

export interface GeoLookupResult {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  network: string | null;
  is_vpn: boolean;
  is_proxy: boolean;
  is_tor: boolean;
  is_datacenter: boolean;
}

const CACHE = new Map<string, { at: number; v: GeoLookupResult }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 1 day cache

export const DeviceFingerprintService = {
  FINGERPRINT_VERSION,

  // ── Fingerprinting ────────────────────────────────────────────────────

  extractComponents(req: Request): FingerprintComponents {
    return {
      user_agent: req.headers['user-agent'] || null,
      accept_language: (req.headers['accept-language'] as string) || null,
      accept_encoding: (req.headers['accept-encoding'] as string) || null,
      platform: (req.headers['sec-ch-ua-platform'] as string) || null,
      screen_resolution: null,
      color_depth: null,
      timezone: null,
      language: null,
      client_hints: {
        'sec-ch-ua': (req.headers['sec-ch-ua'] as string) || '',
        'sec-ch-ua-mobile': (req.headers['sec-ch-ua-mobile'] as string) || '',
        'sec-ch-ua-platform': (req.headers['sec-ch-ua-platform'] as string) || '',
      },
    };
  },

  /**
   * Generate a privacy-preserving, stable fingerprint from request signals.
   *
   * Important: This is NOT a "supercookie" fingerprint. It intentionally uses
   * only signals present in a basic HTTP request, and HMACs them with a
   * per-install salt so hashes cannot be cross-linked between deployments.
   */
  generate(req: Request, components: FingerprintComponents): string {
    const ip = (req.ip || req.socket?.remoteAddress || 'unknown').split(',').shift()?.trim() || 'unknown';
    // Use /24 for IPv4 to avoid NAT churn
    const ipBucket = ip.includes(':')
      ? ip // keep full IPv6 prefix range
      : ip.split('.').slice(0, 3).join('.');
    const ua = normalizeStr(components.user_agent);
    const lang = normalizeStr(components.accept_language);
    const platform = normalizeStr(components.platform || components.client_hints?.['sec-ch-ua-platform']);
    const chUa = normalizeStr(components.client_hints?.['sec-ch-ua']);
    const input = [ipBucket, ua, lang, platform, chUa].join('||');
    return hashStable(input);
  },

  parseDeviceInfo(req: Request): DeviceInfo {
    const ua = req.headers['user-agent'] || null;
    const p = parseUserAgent(ua);
    const info: DeviceInfo = {
      device_type: p.deviceType,
      browser_name: p.browserName,
      browser_version: p.browserVersion,
      os_name: p.osName,
      os_version: p.osVersion,
      platform: p.platform,
      is_mobile: p.isMobile,
      is_tablet: p.isTablet,
      is_desktop: p.isDesktop,
    };
    return info;
  },

  /**
   * Produce a human-readable device label from UA + components.
   */
  humanLabel(req: Request): string {
    const p = parseUserAgent(req.headers['user-agent'] || '');
    const browser = [p.browserName, p.browserVersion].filter(Boolean).join(' ');
    const os = [p.osName, p.osVersion].filter(Boolean).join(' ');
    const label = [browser, os].filter(Boolean).join(' on ') || 'Unknown Device';
    return p.isBot ? `[bot] ${label}` : label;
  },

  // ── Geolocation ───────────────────────────────────────────────────────

  isPrivateIp(ip: string): boolean {
    const clean = ip.split(',').shift()?.trim() || '';
    if (clean.startsWith('10.')) return true;
    if (clean.startsWith('172.')) {
      const o2 = parseInt(clean.split('.')[1] || '0', 10);
      return o2 >= 16 && o2 <= 31;
    }
    if (clean.startsWith('192.168.')) return true;
    if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') return true;
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true; // ULA
    return false;
  },

  async lookupGeo(ip: string): Promise<GeoLookupResult> {
    const empty: GeoLookupResult = {
      country: null,
      region: null,
      city: null,
      latitude: null,
      longitude: null,
      timezone: null,
      network: null,
      is_vpn: false,
      is_proxy: false,
      is_tor: false,
      is_datacenter: false,
    };
    const clean = (ip || '').split(',').shift()?.trim() || '';
    if (!clean || this.isPrivateIp(clean) || clean === 'unknown') return empty;

    const cached = CACHE.get(clean);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.v;

    const provider = env.GEO_PROVIDER?.toLowerCase();
    let result: GeoLookupResult = empty;

    try {
      if (provider === 'ipinfo') {
        const token = env.GEO_IPINFO_TOKEN;
        const url = `https://ipinfo.io/${clean}${token ? `?token=${token}` : ''}`;
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (r.ok) {
          const d: any = await r.json();
          const [lat, lon] = (d.loc || '').split(',').map(parseFloat);
          result = {
            country: d.country || null,
            region: d.region || null,
            city: d.city || null,
            latitude: isFinite(lat) ? lat : null,
            longitude: isFinite(lon) ? lon : null,
            timezone: d.timezone || null,
            network: d.org || d.asn || null,
            is_vpn: d.privacy?.vpn || false,
            is_proxy: d.privacy?.proxy || false,
            is_tor: d.privacy?.tor || false,
            is_datacenter: d.privacy?.hosting || d.company?.type === 'hosting' || false,
          };
        }
      } else if (provider === 'ip-api') {
        const url = `http://ip-api.com/json/${clean}?fields=status,country,regionName,city,lat,lon,timezone,isp,org,mobile,proxy,hosting,query`;
        const r = await fetch(url);
        if (r.ok) {
          const d: any = await r.json();
          if (d.status === 'success') {
            result = {
              country: d.country || null,
              region: d.regionName || null,
              city: d.city || null,
              latitude: isFinite(d.lat) ? d.lat : null,
              longitude: isFinite(d.lon) ? d.lon : null,
              timezone: d.timezone || null,
              network: d.isp || d.org || null,
              is_vpn: d.mobile && d.proxy || false,
              is_proxy: d.proxy || false,
              is_tor: false,
              is_datacenter: d.hosting || false,
            };
          }
        }
      } else if (provider === 'maxmind' || env.MAXMIND_ACCOUNT_ID) {
        // MaxMind GeoIP2 Precision (optional)
        const accountId = env.MAXMIND_ACCOUNT_ID;
        const licenseKey = env.MAXMIND_LICENSE_KEY;
        if (accountId && licenseKey) {
          const url = `https://geolite.info/geoip/v2.1/city/${clean}`;
          const auth = `Basic ${Buffer.from(`${accountId}:${licenseKey}`).toString('base64')}`;
          const r = await fetch(url, { headers: { Authorization: auth } });
          if (r.ok) {
            const d: any = await r.json();
            result = {
              country: d.country?.iso_code || null,
              region: d.subdivisions?.[0]?.names?.en || null,
              city: d.city?.names?.en || null,
              latitude: isFinite(d.location?.latitude) ? d.location.latitude : null,
              longitude: isFinite(d.location?.longitude) ? d.location.longitude : null,
              timezone: d.location?.time_zone || null,
              network: d.traits?.network || null,
              is_vpn: d.traits?.is_anonymous_proxy || d.traits?.is_anonymous_vpn || false,
              is_proxy: d.traits?.is_anonymous_proxy || false,
              is_tor: d.traits?.is_anonymous_tor || false,
              is_datacenter: d.traits?.is_hosting_provider || false,
            };
          }
        }
      }
    } catch (e: any) {
      // Geo lookup failures must never break session creation.
    }

    CACHE.set(clean, { at: Date.now(), v: result });
    return result;
  },

  // ── Geo Anomaly: rapid travel / impossible location ───────────────────

  /**
   * Haversine distance in kilometers between two lat/lon points.
   */
  haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (x: number) => (x * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  },

  /**
   * Given a previous known location and the current location (with the
   * elapsed time between), check whether the travel is impossible.
   * Threshold: 1000 km/h (faster than a commercial jet).
   */
  detectImpossibleTravel(params: {
    lat1: number;
    lon1: number;
    lat2: number;
    lon2: number;
    hoursDelta: number;
    thresholdKmh?: number;
  }): { impossible: boolean; distanceKm: number; speedKmh: number } {
    const { lat1, lon1, lat2, lon2, hoursDelta, thresholdKmh = 1000 } = params;
    const distanceKm = this.haversineKm(lat1, lon1, lat2, lon2);
    if (hoursDelta <= 0 || distanceKm < 50) {
      return { impossible: false, distanceKm, speedKmh: 0 };
    }
    const speedKmh = distanceKm / hoursDelta;
    return { impossible: speedKmh > thresholdKmh, distanceKm, speedKmh };
  },
};
