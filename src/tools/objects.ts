/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import type { IManifolderPromiseClient } from '../client/index.js';
import type { CreateObjectParams, EarthAttachmentParentResult, FabricObject, MutatedObject, UpdateObjectParams } from '../types.js';
import { objectTypeSchema, resolveCompositeObjectType, transformFields, celestialFields, vector3Schema, scopeTargetParams, findEarthAttachmentParentSchema } from './schemas.js';
import { paginate } from '../output.js';
import { resolveScopeTarget } from './scope-target.js';
import { shapeObjectResponse } from './response-shapers.js';
import { asMCPClient } from './mcp-client.js';

type ScopeTargetOnly = { scopeId?: string; profile?: string; url?: string };

function stripScopeTarget<T extends ScopeTargetOnly>(args: T): Omit<T, keyof ScopeTargetOnly> {
  const { scopeId: _scopeId, profile: _profile, url: _url, ...rest } = args;
  return rest;
}

export const objectTools = {
  list_objects: {
    description: 'List already-loaded objects in a scene (shallow). Objects whose children have not been loaded yet will show childCount: -1. Use get_object to load a specific object and its children, or find_objects to deep-search.',
    inputSchema: z.object({
      ...scopeTargetParams,
      anchorObjectId: z.string().describe('Object ID to scope the listing to. Typically a scene root from list_scenes, but can be any object. (e.g., "physical:1", "terrestrial:3")'),
      filter: z.object({
        namePattern: z.string().optional().describe('Regex pattern to filter by name (client-side, applied to cached objects)'),
        type: z.string().optional().describe('Filter by class ("terrestrial") or by class:subtype ("terrestrial:parcel")'),
      }).optional().describe('Optional filter criteria'),
      offset: z.number().optional().describe('Skip first N results (default: 0)'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
    }),
  },
  get_object: {
    description: 'Get full details of a specific object',
    inputSchema: z.object({
      ...scopeTargetParams,
      objectId: z.string().describe('ID of the object (e.g., "physical:42", "terrestrial:3")'),
    }),
  },
  create_object: {
    description: 'Create a new object in the scene. For regular 3D models, set resourceReference to the url returned by upload_resource or list_resources. For action resources (lights, text, rotators, video), set resourceReference to the action URI and resourceName to the uploaded JSON config url. To create an attachment point, append ":attachment" to objectType (e.g., "celestial:surface:attachment") and set resourceReference to the child scene fabric URL.',
    inputSchema: z.object({
      parentId: z.string().describe('ID of the parent object (e.g., "physical:123", "terrestrial:3", or "root")'),
      name: z.string().describe('Name for the new object'),
      ...transformFields,
      ...celestialFields,
      objectType: objectTypeSchema.optional(),
      ...scopeTargetParams,
    }),
  },
  update_object: {
    description: 'Update properties of an existing object. Use objectType to change type and/or subtype (class is validated but immutable).',
    inputSchema: z.object({
      objectId: z.string().describe('ID of the object to update (e.g., "physical:42", "terrestrial:3")'),
      name: z.string().optional().describe('New name'),
      ...transformFields,
      ...celestialFields,
      objectType: objectTypeSchema.optional(),
      ...scopeTargetParams,
    }),
  },
  delete_object: {
    description: 'Delete an object and its children. The object class is derived from the prefixed ID.',
    inputSchema: z.object({
      ...scopeTargetParams,
      objectId: z.string().describe('ID of the object to delete (e.g., "physical:42", "terrestrial:3")'),
    }),
  },
  move_object: {
    description: 'Reparent an object to a new parent',
    inputSchema: z.object({
      ...scopeTargetParams,
      objectId: z.string().describe('ID of the object to move (e.g., "physical:42")'),
      newParentId: z.string().describe('ID of the new parent object (e.g., "terrestrial:3")'),
    }),
  },
  find_objects: {
    description: 'Search for objects by name pattern, position radius, or resource URL using an in-scope anchor object ID.',
    inputSchema: z.object({
      ...scopeTargetParams,
      anchorObjectId: z.string().optional().describe('Object ID to scope the search to. Defaults to the terrestrial root when omitted.'),
      query: z.object({
        namePattern: z.string().optional().describe('Name prefix to search for (begins-with matching, case-insensitive)'),
        positionRadius: z.object({
          center: vector3Schema,
          radius: z.number(),
        }).optional(),
        resourceUrl: z.string().optional().describe('Match objects with this resource URL'),
      }),
      offset: z.number().optional().describe('Skip first N results (default: 0)'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
    }),
  },
  find_earth_attachment_parent: {
    description: 'Find the smallest terrestrial parent object for an Earth campus attachment and compute the attachment geometry needed to create the attachment point.',
    inputSchema: findEarthAttachmentParentSchema,
  },
};

export async function handleListObjects(
  client: IManifolderPromiseClient,
  args: { scopeId?: string; profile?: string; url?: string; anchorObjectId: string; filter?: { namePattern?: string; type?: string }; offset?: number; limit?: number }
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const target = await resolveScopeTarget(args, client, {
    allowImplicitFallback: true,
    isCUD: false,
  });
  const objects = await mcpClient.listObjects({
    scopeId: target.scopeId,
    anchorObjectId: args.anchorObjectId,
    filter: args.filter,
  }) as FabricObject[];
  const items = objects.map((obj) => ({
    ...shapeObjectResponse(target.scopeId, obj),
    hasResource: !!obj.resourceReference,
  }));
  return JSON.stringify(paginate(items, args.offset, args.limit));
}

export async function handleGetObject(
  client: IManifolderPromiseClient,
  args: { scopeId?: string; profile?: string; url?: string; objectId: string }
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const target = await resolveScopeTarget(args, client, {
    allowImplicitFallback: true,
    isCUD: false,
  });
  const obj = await mcpClient.getObject({ scopeId: target.scopeId, objectId: args.objectId }) as FabricObject;
  return JSON.stringify(shapeObjectResponse(target.scopeId, obj));
}

export async function handleCreateObject(
  client: IManifolderPromiseClient,
  args: Omit<CreateObjectParams, 'skipParentRefetch'> & ScopeTargetOnly
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const target = await resolveScopeTarget(args, client, {
    allowImplicitFallback: false,
    isCUD: true,
  });
  const { objectType: compositeType, subtype: _sub, ...rest } = stripScopeTarget(args);
  const resolved = compositeType ? resolveCompositeObjectType(compositeType) : {};
  const obj = await mcpClient.createObject({ scopeId: target.scopeId, ...rest, ...resolved }) as MutatedObject;
  return JSON.stringify({ ...shapeObjectResponse(target.scopeId, obj), confirmed: obj.confirmed });
}

export async function handleUpdateObject(
  client: IManifolderPromiseClient,
  args: Omit<UpdateObjectParams, 'skipRefetch'> & ScopeTargetOnly
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const target = await resolveScopeTarget(args, client, {
    allowImplicitFallback: false,
    isCUD: true,
  });
  const { objectType: compositeType, subtype: _sub, ...rest } = stripScopeTarget(args);
  const resolved = compositeType ? resolveCompositeObjectType(compositeType) : {};
  const obj = await mcpClient.updateObject({ scopeId: target.scopeId, ...rest, ...resolved }) as MutatedObject;
  return JSON.stringify({ ...shapeObjectResponse(target.scopeId, obj), confirmed: obj.confirmed });
}

export async function handleDeleteObject(
  client: IManifolderPromiseClient,
  args: { scopeId?: string; profile?: string; url?: string; objectId: string }
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const target = await resolveScopeTarget(args, client, {
    allowImplicitFallback: false,
    isCUD: true,
  });
  const result = await mcpClient.deleteObject({ scopeId: target.scopeId, objectId: args.objectId });
  return JSON.stringify({ success: true, scopeId: target.scopeId, deletedObjectId: args.objectId, confirmed: result.confirmed });
}

export async function handleMoveObject(
  client: IManifolderPromiseClient,
  args: { scopeId?: string; profile?: string; url?: string; objectId: string; newParentId: string }
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const target = await resolveScopeTarget(args, client, {
    allowImplicitFallback: false,
    isCUD: true,
  });
  const moved = await mcpClient.moveObject({
    scopeId: target.scopeId,
    objectId: args.objectId,
    newParentId: args.newParentId,
  }) as MutatedObject;
  return JSON.stringify({ ...shapeObjectResponse(target.scopeId, moved), confirmed: moved.confirmed });
}

export async function handleFindObjects(
  client: IManifolderPromiseClient,
  args: {
    scopeId?: string;
    profile?: string;
    url?: string;
    anchorObjectId?: string;
    query: {
      namePattern?: string;
      positionRadius?: { center: { x: number; y: number; z: number }; radius: number };
      resourceUrl?: string;
    };
    offset?: number;
    limit?: number;
  }
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const target = await resolveScopeTarget(args, client, {
    allowImplicitFallback: true,
    isCUD: false,
  });
  const objects = await mcpClient.findObjects({
    scopeId: target.scopeId,
    anchorObjectId: args.anchorObjectId,
    query: args.query,
  }) as FabricObject[];
  const items = objects.map((obj) => shapeObjectResponse(target.scopeId, obj));
  const result = paginate(items, args.offset, args.limit);
  return JSON.stringify(result);
}

export async function handleFindEarthAttachmentParent(
  client: IManifolderPromiseClient,
  args: {
    scopeId?: string;
    profile?: string;
    url?: string;
    anchorObjectId?: string;
    lat?: number;
    lon?: number;
    boundX?: number;
    boundZ?: number;
    boundY?: number;
    nodes?: { lat: number; lon: number }[];
    city?: string;
    community?: string;
    county?: string;
    state?: string;
    country?: string;
  }
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const target = await resolveScopeTarget(args, client, {
    allowImplicitFallback: true,
    isCUD: false,
  });
  const result = await mcpClient.findEarthAttachmentParent({
    scopeId: target.scopeId,
    ...stripScopeTarget(args),
  }) as EarthAttachmentParentResult;
  return JSON.stringify(result);
}
