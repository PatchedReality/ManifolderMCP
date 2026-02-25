import type { IManifolderPromiseClient } from '../client/index.js';

const scopeProfilesByClient = new WeakMap<IManifolderPromiseClient, Map<string, string | null>>();

export function getScopeProfileMap(client: IManifolderPromiseClient): Map<string, string | null> {
  let map = scopeProfilesByClient.get(client);
  if (!map) {
    map = new Map<string, string | null>();
    scopeProfilesByClient.set(client, map);
  }
  return map;
}

export function setScopeAssociatedProfile(
  client: IManifolderPromiseClient,
  scopeId: string,
  associatedProfile: string | null
): void {
  getScopeProfileMap(client).set(scopeId, associatedProfile ?? null);
}

export function getScopeAssociatedProfile(
  client: IManifolderPromiseClient,
  scopeId: string
): string | null {
  return getScopeProfileMap(client).get(scopeId) ?? null;
}

export function clearScopeAssociatedProfiles(
  client: IManifolderPromiseClient,
  scopeIds: string[]
): void {
  const map = getScopeProfileMap(client);
  for (const scopeId of scopeIds) {
    map.delete(scopeId);
  }
}

