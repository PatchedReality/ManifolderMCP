import { z } from 'zod';
import type { MVFabricClient } from '../client/MVFabricClient.js';
import type { BulkOperation } from '../types.js';
import { objectTypeSchema, transformFields, celestialFields, vector3Schema } from './schemas.js';
import { paginate } from '../output.js';

const operationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create'),
    params: z.object({
      parentId: z.string(),
      name: z.string(),
      ...transformFields,
      ...celestialFields,
      objectType: objectTypeSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal('update'),
    params: z.object({
      objectId: z.string(),
      name: z.string().optional(),
      ...transformFields,
      ...celestialFields,
    }),
  }),
  z.object({
    type: z.literal('delete'),
    params: z.object({
      objectId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('move'),
    params: z.object({
      objectId: z.string(),
      newParentId: z.string(),
    }),
  }),
]);

export const bulkTools = {
  bulk_update: {
    description: 'Execute multiple operations in a single batch. Operations execute sequentially; failures are collected but do not stop subsequent operations. Operations cannot reference IDs created by earlier operations in the same batch.',
    inputSchema: z.object({
      operations: z.array(operationSchema).describe('Array of operations to execute'),
    }),
  },
  find_objects: {
    description: 'Search for objects by name pattern, position radius, or resource URL. Uses server-side SEARCH action for name queries (case-insensitive begins-with matching). For non-text queries, loads the full subtree under the scoped object, and searches in-memory. Avoid using on root objects, or for fabrics with deep hierarchies.',
    inputSchema: z.object({
      scopeId: z.string().describe('Object ID to scope the search to. Typically a scene root from list_scenes, but can be any object. (e.g., "physical:1", "terrestrial:3")'),
      query: z.object({
        namePattern: z.string().optional().describe('Name prefix to search for (begins-with matching, case-insensitive)'),
        positionRadius: z.object({
          center: vector3Schema,
          radius: z.number(),
        }).optional().describe('Search within radius of a point'),
        resourceUrl: z.string().optional().describe('Match objects with this resource URL'),
      }).describe('Search criteria'),
      offset: z.number().optional().describe('Skip first N results (default: 0)'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
    }),
  },
};

export async function handleBulkUpdate(
  client: MVFabricClient,
  args: { operations: BulkOperation[] }
): Promise<string> {
  const result = await client.bulkUpdate(args.operations);
  return JSON.stringify({
    success: result.success,
    failed: result.failed,
    createdIds: result.createdIds,
    errors: result.errors,
  });
}

export async function handleFindObjects(
  client: MVFabricClient,
  args: {
    scopeId: string;
    query: {
      namePattern?: string;
      positionRadius?: { center: { x: number; y: number; z: number }; radius: number };
      resourceUrl?: string;
    };
    offset?: number;
    limit?: number;
  }
): Promise<string> {
  const objects = await client.findObjects(args.scopeId, args.query);
  const items = objects.map(obj => ({
    id: obj.id,
    name: obj.name,
    position: obj.transform.position,
    resourceReference: obj.resourceReference,
  }));
  const result = paginate(items, args.offset, args.limit);
  if (result.total === 0 && args.query.namePattern) {
    return JSON.stringify({ ...result, hint: 'No results found. Search uses case-insensitive begins-with matching on the name. Try a shorter prefix, or use get_object to browse the hierarchy manually.' });
  }
  return JSON.stringify(result);
}
