/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import type { IManifolderPromiseClient } from '../client/index.js';
import type { FabricObject, Scene } from '../types.js';
import { parseObjectRef } from '../types.js';
import { objectTypeSchema, scopeTargetParams } from './schemas.js';
import { paginate } from '../output.js';
import { resolveScopeTarget } from './scope-target.js';
import { shapeObjectResponse, shapeSceneSummary } from './response-shapers.js';
import { asMCPClient } from './mcp-client.js';

export const sceneTools = {
  list_scenes: {
    description: 'List all scenes in a scope. Provide one scope target (`scopeId` | `profile` | `url`) or rely on read fallback when a single connected root scope exists.',
    inputSchema: z.object({
      offset: z.number().optional().describe('Skip first N results (default: 0)'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
      ...scopeTargetParams,
    }),
  },
  open_scene: {
    description: 'Load a scene and return the same payload shape as get_object for the opened root, plus url.',
    inputSchema: z.object({
      sceneId: z.string().describe('ID of the scene to open (e.g., "physical:1", "terrestrial:3")'),
      ...scopeTargetParams,
    }),
  },
  create_scene: {
    description: 'Create a new empty scene in the resolved scope.',
    inputSchema: z.object({
      name: z.string().describe('Name for the new scene'),
      objectType: objectTypeSchema.optional().describe('Object type for the scene root. Examples: "terrestrial:sector", "celestial:planet". Defaults to "physical:default" when omitted.'),
      ...scopeTargetParams,
    }),
  },
  delete_scene: {
    description: 'Delete a scene and all its children in the resolved scope.',
    inputSchema: z.object({
      sceneId: z.string().describe('ID of the scene to delete (e.g., "physical:1", "terrestrial:3")'),
      ...scopeTargetParams,
    }),
  },
};

export async function handleListScenes(
  client: IManifolderPromiseClient,
  args: { offset?: number; limit?: number; scopeId?: string; profile?: string; url?: string }
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const target = await resolveScopeTarget(args, client, {
    allowImplicitFallback: true,
    isCUD: false,
  });
  const scenes = await mcpClient.listScenes({ scopeId: target.scopeId }) as Scene[];
  const rootUrl = mcpClient.getResourceRootUrl({ scopeId: target.scopeId });
  const items = scenes.map((scene) => shapeSceneSummary(target.scopeId, scene, rootUrl));
  return JSON.stringify(paginate(items, args.offset, args.limit));
}

export async function handleOpenScene(
  client: IManifolderPromiseClient,
  args: { sceneId: string; scopeId?: string; profile?: string; url?: string }
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const target = await resolveScopeTarget(args, client, {
    allowImplicitFallback: true,
    isCUD: false,
  });
  const root = await mcpClient.openScene({ scopeId: target.scopeId, sceneId: args.sceneId }) as FabricObject;
  const rootUrl = mcpClient.getResourceRootUrl({ scopeId: target.scopeId });
  const normalizedRoot = rootUrl.endsWith('/') ? rootUrl.slice(0, -1) : rootUrl;
  const { classId, numericId } = parseObjectRef(root.id);
  return JSON.stringify({
    ...shapeObjectResponse(target.scopeId, root),
    url: `${normalizedRoot}/fabric/${classId}/${numericId}`,
  });
}

export async function handleCreateScene(
  client: IManifolderPromiseClient,
  args: { name: string; objectType?: string; scopeId?: string; profile?: string; url?: string }
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const target = await resolveScopeTarget(args, client, {
    allowImplicitFallback: false,
    isCUD: true,
  });
  const scene = await mcpClient.createScene({ scopeId: target.scopeId, name: args.name, objectType: args.objectType }) as Scene;
  const rootUrl = mcpClient.getResourceRootUrl({ scopeId: target.scopeId });

  return JSON.stringify({ scene: shapeSceneSummary(target.scopeId, scene, rootUrl) });
}

export async function handleDeleteScene(
  client: IManifolderPromiseClient,
  args: { sceneId: string; scopeId?: string; profile?: string; url?: string }
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const target = await resolveScopeTarget(args, client, {
    allowImplicitFallback: false,
    isCUD: true,
  });
  await mcpClient.deleteScene({ scopeId: target.scopeId, sceneId: args.sceneId });
  return JSON.stringify({ success: true, scopeId: target.scopeId, deletedSceneId: args.sceneId });
}
