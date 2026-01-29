import { z } from 'zod';
import type { MVFabricClient } from '../client/MVFabricClient.js';
import type { BulkOperation } from '../types.js';
import { quaternionSchema, vector3Schema } from './schemas.js';

const operationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create'),
    params: z.object({
      parentId: z.string(),
      name: z.string(),
      position: vector3Schema.optional(),
      rotation: quaternionSchema.optional(),
      scale: vector3Schema.optional(),
      resource: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('update'),
    params: z.object({
      objectId: z.string(),
      name: z.string().optional(),
      position: vector3Schema.optional(),
      rotation: quaternionSchema.optional(),
      scale: vector3Schema.optional(),
      resource: z.string().optional(),
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
    description: 'Execute multiple operations atomically',
    inputSchema: z.object({
      operations: z.array(operationSchema).describe('Array of operations to execute'),
    }),
  },
  find_objects: {
    description: 'Search for objects by name pattern, position radius, or resource URL',
    inputSchema: z.object({
      sceneId: z.string().describe('ID of the scene to search'),
      query: z.object({
        namePattern: z.string().optional().describe('Regex pattern to match object names'),
        positionRadius: z.object({
          center: vector3Schema,
          radius: z.number(),
        }).optional().describe('Search within radius of a point'),
        resourceUrl: z.string().optional().describe('Match objects with this resource URL'),
      }).describe('Search criteria'),
    }),
  },
};

export async function handleBulkUpdate(
  client: MVFabricClient,
  args: { operations: BulkOperation[] }
): Promise<string> {
  const result = await client.bulkUpdate(args.operations);
  return JSON.stringify(result);
}

export async function handleFindObjects(
  client: MVFabricClient,
  args: {
    sceneId: string;
    query: {
      namePattern?: string;
      positionRadius?: { center: { x: number; y: number; z: number }; radius: number };
      resourceUrl?: string;
    };
  }
): Promise<string> {
  const objects = await client.findObjects(args.sceneId, args.query);
  return JSON.stringify({
    count: objects.length,
    objects: objects.map(obj => ({
      id: obj.id,
      name: obj.name,
      position: obj.transform.position,
      resource: obj.resource,
    })),
  });
}
