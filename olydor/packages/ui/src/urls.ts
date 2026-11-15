export interface OlydorPlatformUrls {
  webUrl: string;
  insightUrl: string;
  arenaUrl: string;
  apiUrl: string;
}

export interface ResolvePlatformUrlsOptions {
  /** Override detected hostname (useful for SSR or unit tests). */
  hostname?: string | null;
  /** Override local-dev detection explicitly. */
  isDev?: boolean;
}

export const DEFAULT_PROD_URLS: OlydorPlatformUrls = {
  webUrl: 'https://olydor.app',
  insightUrl: 'https://insight.olydor.app',
  arenaUrl: 'https://arena.olydor.app',
  apiUrl: 'https://api.olydor.app',
};

export const DEFAULT_LOCAL_URLS: OlydorPlatformUrls = {
  webUrl: 'http://localhost:3001',
  insightUrl: 'http://localhost:3002',
  arenaUrl: 'http://localhost:3003',
  apiUrl: 'http://localhost:3000',
};

function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Returns true if the given hostname points to the local machine.
 */
export function isLocalHost(hostname?: string | null): boolean {
  if (!hostname) return false;
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized.endsWith('.localhost')
  );
}

/**
 * Returns true if a full URL points to a local host.
 */
export function isLocalUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    return isLocalHost(new URL(url).hostname);
  } catch {
    return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(
      url.trim(),
    );
  }
}

/**
 * Returns true if the URL matches one of the hardcoded production Olydor origins.
 */
export function isDefaultProdUrl(url?: string | null): boolean {
  if (!url) return false;
  const normalized = stripTrailingSlash(url);
  return (
    normalized === DEFAULT_PROD_URLS.webUrl ||
    normalized === DEFAULT_PROD_URLS.insightUrl ||
    normalized === DEFAULT_PROD_URLS.arenaUrl ||
    normalized === DEFAULT_PROD_URLS.apiUrl
  );
}

function getRuntimeHostname(options?: ResolvePlatformUrlsOptions): string | null {
  if (options && 'hostname' in options) {
    return options.hostname ?? null;
  }
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return window.location.hostname;
  }
  return null;
}

/**
 * Determines whether local localhost ports should be preferred over production URLs.
 */
export function isLocalDevEnvironment(options?: ResolvePlatformUrlsOptions): boolean {
  if (options && typeof options.isDev === 'boolean') {
    return options.isDev;
  }
  const hostname = getRuntimeHostname(options);
  if (hostname !== null) {
    return isLocalHost(hostname);
  }
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
}

function buildLocalDefaults(hostname?: string | null): OlydorPlatformUrls {
  const host = hostname?.trim().toLowerCase() === '127.0.0.1' ? '127.0.0.1' : 'localhost';
  return {
    webUrl: `http://${host}:3001`,
    insightUrl: `http://${host}:3002`,
    arenaUrl: `http://${host}:3003`,
    apiUrl: `http://${host}:3000`,
  };
}

function pickUrl(
  configuredValue: string | undefined,
  fallbackValue: string,
  preferLocal: boolean,
): string {
  const cleaned = configuredValue ? stripTrailingSlash(configuredValue) : '';
  if (!cleaned) {
    return fallbackValue;
  }
  if (preferLocal && isDefaultProdUrl(cleaned)) {
    return fallbackValue;
  }
  if (!preferLocal && isLocalUrl(cleaned)) {
    return fallbackValue;
  }
  return cleaned;
}

/**
 * Resolves cross-app URLs (web, insight, arena, api) dynamically for local dev vs production.
 */
export function resolvePlatformUrls(
  configured?: Partial<OlydorPlatformUrls>,
  options?: ResolvePlatformUrlsOptions,
): OlydorPlatformUrls {
  const hostname = getRuntimeHostname(options);
  const preferLocal = isLocalDevEnvironment(options);
  const defaults = preferLocal ? buildLocalDefaults(hostname) : DEFAULT_PROD_URLS;

  return {
    webUrl: pickUrl(configured?.webUrl, defaults.webUrl, preferLocal),
    insightUrl: pickUrl(configured?.insightUrl, defaults.insightUrl, preferLocal),
    arenaUrl: pickUrl(configured?.arenaUrl, defaults.arenaUrl, preferLocal),
    apiUrl: pickUrl(configured?.apiUrl, defaults.apiUrl, preferLocal),
  };
}
