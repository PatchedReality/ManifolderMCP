/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IManifolderPromiseClient } from '../client/index.js';
import { computeRootScopeId } from '../client/index.js';
import { getProfile, loadConfig, type ProfileConfig } from '../config.js';
import { toolError } from './errors.js';
import { setScopeAssociatedProfile } from './scope-profile-registry.js';

export interface ScopeTargetInput {
  scopeId?: string;
  profile?: string;
  url?: string;
}

export interface ScopeTargetResolution {
  scopeId: string;
  source: 'scopeId' | 'profile' | 'url' | 'fallback';
}

function countProvidedTargets(input: ScopeTargetInput): number {
  return [input.scopeId, input.profile, input.url].filter(Boolean).length;
}

export async function resolveScopeTarget(
  input: ScopeTargetInput,
  client: IManifolderPromiseClient,
  options: { allowImplicitFallback: boolean; isCUD: boolean }
): Promise<ScopeTargetResolution> {
  const provided = countProvidedTargets(input);
  if (provided > 1) {
    throw toolError({
      code: 'SCOPE_TARGET_CONFLICT',
      message: 'Exactly one of scopeId, profile, or url may be provided.',
    });
  }

  if (input.scopeId) {
    const scope = client.listScopes().find((entry) => entry.scopeId === input.scopeId);
    if (!scope) {
      throw toolError({
        code: 'SCOPE_NOT_FOUND',
        message: `Scope not found: ${input.scopeId}`,
        scopeId: input.scopeId,
      });
    }
    return { scopeId: input.scopeId, source: 'scopeId' };
  }

  if (input.profile) {
    let profile: ProfileConfig;
    try {
      profile = await getProfile(input.profile);
    } catch (error) {
      throw toolError({
        code: 'SCOPE_NOT_FOUND',
        message: (error as Error).message,
      });
    }

    try {
      registerUnsafeHosts(profile);
      (globalThis as any).__manifolderSSLErrors = [];
      const connected = await client.connectRoot({
        fabricUrl: profile.fabricUrl,
        adminKey: profile.adminKey ?? '',
      });
      setScopeAssociatedProfile(client, connected.scopeId, input.profile);
      return { scopeId: connected.scopeId, source: 'profile' };
    } catch (error) {
      const sslErrors: string[] = (globalThis as any).__manifolderSSLErrors || [];
      const unique = [...new Set(sslErrors)];
      let message = (error as Error).message;
      if (unique.length) {
        const existing = profile.unsafeHosts || [];
        const merged = [...new Set([...existing, ...unique])];
        const jsonVal = JSON.stringify(merged);
        message += ` — SSL certificate errors. Add to ~/.config/manifolder-mcp/config.json ` +
          `in the "${input.profile}" profile: "unsafeHosts": ${jsonVal}`;
      }
      throw toolError({
        code: 'SCOPE_CONNECT_FAILED',
        message,
      });
    }
  }

  if (input.url) {
    try {
      const connected = await client.connectRoot({
        fabricUrl: input.url,
        adminKey: '',
      });
      const associatedProfile = await resolveAssociatedProfileForUrl(input.url).catch(() => null);
      setScopeAssociatedProfile(client, connected.scopeId, associatedProfile);
      return { scopeId: connected.scopeId, source: 'url' };
    } catch (error) {
      throw toolError({
        code: 'SCOPE_CONNECT_FAILED',
        message: (error as Error).message,
      });
    }
  }

  if (!options.allowImplicitFallback || options.isCUD) {
    throw toolError({
      code: 'SCOPE_TARGET_MISSING',
      message: 'An explicit scope target is required for this operation.',
    });
  }

  const connectedRootScopeIds = client
    .listScopes()
    .filter((scope) => scope.parentScopeId === null)
    .map((scope) => scope.scopeId)
    .filter((scopeId) => client.getScopeStatus({ scopeId }).connected);

  if (connectedRootScopeIds.length === 1) {
    return { scopeId: connectedRootScopeIds[0], source: 'fallback' };
  }

  throw toolError({
    code: 'SCOPE_TARGET_AMBIGUOUS',
    message: 'No unique connected root scope is available for implicit fallback.',
  });
}

export async function resolveProfileTarget(input: {
  profile?: string;
  scopeId?: string;
  url?: string;
}): Promise<{ profileName: string; profile: ProfileConfig }> {
  if (input.scopeId || input.url) {
    throw toolError({
      code: 'SCOPE_TARGET_CONFLICT',
      message: 'Resource tools only accept profile targeting.',
    });
  }

  if (!input.profile) {
    throw toolError({
      code: 'SCOPE_TARGET_MISSING',
      message: 'Resource operations require an explicit profile.',
    });
  }

  try {
    const profile = await getProfile(input.profile);
    return { profileName: input.profile, profile };
  } catch (error) {
    throw toolError({
      code: 'SCOPE_NOT_FOUND',
      message: (error as Error).message,
    });
  }
}

export async function resolveAssociatedProfileForUrl(fabricUrl: string): Promise<string | null> {
  const config = await loadConfig();
  const entries = Object.entries(config).map(([name, profile]) => ({
    name,
    rootHashPromise: computeRootScopeId(profile.fabricUrl),
    fabricUrl: profile.fabricUrl,
  }));

  const targetHash = await computeRootScopeId(fabricUrl);
  const resolvedEntries = await Promise.all(entries.map(async (entry) => ({
    ...entry,
    rootHash: await entry.rootHashPromise,
  })));

  const exact = resolvedEntries.filter((entry) => entry.rootHash === targetHash);
  if (exact.length === 1) {
    return exact[0].name;
  }

  const targetOrigin = new URL(fabricUrl).origin;
  const originMatches = resolvedEntries.filter((entry) => new URL(entry.fabricUrl).origin === targetOrigin);
  if (originMatches.length === 1) {
    return originMatches[0].name;
  }

  return null;
}

function registerUnsafeHosts(profile: ProfileConfig): void {
  if (profile.unsafeHosts?.length) {
    const set: Set<string> = (globalThis as any).__manifolderUnsafeHosts;
    if (set) {
      for (const host of profile.unsafeHosts) {
        set.add(host);
      }
    }
  }
}
