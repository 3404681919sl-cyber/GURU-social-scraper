const PREVIEW_KEYS = ["eo_token", "eo_time"] as const;

export function carryPreviewAccess(source: URL, target: URL) {
  if (source.origin !== target.origin) return target;
  for (const key of PREVIEW_KEYS) {
    const value = source.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }
  return target;
}

export function browserInternalUrl(path: string) {
  if (typeof window === "undefined") return path;
  const current = new URL(window.location.href);
  const hasPreviewAccess = PREVIEW_KEYS.some((key) => current.searchParams.has(key));
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const baseUrl = !hasPreviewAccess && configuredSiteUrl ? configuredSiteUrl : current.origin;
  return carryPreviewAccess(current, new URL(path, baseUrl)).toString();
}
