/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import type { IManifolderPromiseClient } from '../client/index.js';
import { paginate } from '../output.js';
import { scopeTargetParams } from './schemas.js';
import { resolveScopeTarget, resolveAssociatedProfileForUrl } from './scope-target.js';
import { asMCPClient } from './mcp-client.js';
import {
  clearScopeAssociatedProfiles,
  getScopeAssociatedProfile,
  setScopeAssociatedProfile,
} from './scope-profile-registry.js';

export const scopeTools = {
  list_scopes: {
    description: 'List active scopes and parent/attachment relationships.',
    inputSchema: z.object({
      offset: z.number().optional().describe('Skip first N results (default: 0)'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
    }),
  },
  follow_attachment: {
    description: 'Resolve and open a child scope from an attachment-capable object. The object must already have its resourceReference set to the fabric URL of a child scene (from create_scene or list_scenes). Set this via update_object before calling follow_attachment.',
    inputSchema: z.object({
      ...scopeTargetParams,
      objectId: z.string(),
      autoOpenRoot: z.boolean().optional(),
    }),
  },
  close_scope: {
    description: 'Close one scope and optionally its descendants.',
    inputSchema: z.object({
      scopeId: z.string(),
      cascade: z.boolean().optional(),
    }),
  },
};

export async function handleListScopes(
  client: IManifolderPromiseClient,
  args: { offset?: number; limit?: number }
): Promise<string> {
  const items = client.listScopes().map((scope) => ({
    ...scope,
    associatedProfile: getScopeAssociatedProfile(client, scope.scopeId),
  }));
  return JSON.stringify(paginate(items, args.offset, args.limit));
}

export async function handleFollowAttachment(
  client: IManifolderPromiseClient,
  args: { scopeId?: string; profile?: string; url?: string; objectId: string; autoOpenRoot?: boolean }
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const { scopeId } = await resolveScopeTarget(args, client, {
    allowImplicitFallback: false,
    isCUD: false,
  });
  const result = await mcpClient.followAttachment({
    scopeId,
    objectId: args.objectId,
    autoOpenRoot: args.autoOpenRoot,
  });

  const associatedProfile = getScopeAssociatedProfile(client, result.childScopeId)
    ?? await resolveAssociatedProfileForUrl(result.childFabricUrl).catch(() => null);
  setScopeAssociatedProfile(client, result.childScopeId, associatedProfile);

  return JSON.stringify({
    ...result,
    associatedProfile,
  });
}

export async function handleCloseScope(
  client: IManifolderPromiseClient,
  args: { scopeId: string; cascade?: boolean }
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const result = await mcpClient.closeScope({ scopeId: args.scopeId, cascade: args.cascade ?? false });
  clearScopeAssociatedProfiles(client, result.closedScopeIds ?? []);
  return JSON.stringify(result);
}
