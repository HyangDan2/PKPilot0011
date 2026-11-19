/** Resolve a bundled asset against Vite's base so the app works on
 *  https://hyangdan2.github.io/PKPilot0011/ as well as on localhost. */
export function assetUrl(relativePath: string): string {
  const env = import.meta as unknown as { env?: { BASE_URL?: string } };
  const base = env.env?.BASE_URL || './';
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  return `${cleanBase}${cleanPath}`;
}

/** Back-compat alias used by the ported LUT loader. */
export const getAssetUrl = assetUrl;
