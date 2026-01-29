import { z } from 'zod';
import type { IFabricClient } from '../client/IFabricClient.js';
import { quaternionSchema, vector3Schema } from './schemas.js';

export const objectTools = {
  list_objects: {
    description: 'List objects in a scene with optional filtering',
    inputSchema: z.object({
      sceneId: z.string().describe('ID of the scene'),
      filter: z.object({
        namePattern: z.string().optional().describe('Regex pattern to filter by name'),
        type: z.string().optional().describe('Object type to filter by'),
      }).optional().describe('Optional filter criteria'),
    }),
  },
  get_object: {
    description: 'Get full details of a specific object',
    inputSchema: z.object({
      objectId: z.string().describe('ID of the object'),
    }),
  },
  create_object: {
    description: 'Create a new object in the scene',
    inputSchema: z.object({
      parentId: z.string().describe('ID of the parent object'),
      name: z.string().describe('Name for the new object'),
      position: vector3Schema.optional().describe('Position (default: 0,0,0)'),
      rotation: quaternionSchema.optional().describe('Rotation quaternion (default: identity)'),
      scale: vector3Schema.optional().describe('Scale (default: 1,1,1)'),
      resource: z.string().optional().describe('URL to a .glb or other resource'),
    }),
  },
  update_object: {
    description: 'Update properties of an existing object',
    inputSchema: z.object({
      objectId: z.string().describe('ID of the object to update'),
      name: z.string().optional().describe('New name'),
      position: vector3Schema.optional().describe('New position'),
      rotation: quaternionSchema.optional().describe('New rotation'),
      scale: vector3Schema.optional().describe('New scale'),
      resource: z.string().optional().describe('New resource URL'),
    }),
  },
  delete_object: {
    description: 'Delete an object and its children',
    inputSchema: z.object({
      objectId: z.string().describe('ID of the object to delete'),
    }),
  },
  move_object: {
    description: 'Reparent an object to a new parent',
    inputSchema: z.object({
      objectId: z.string().describe('ID of the object to move'),
      newParentId: z.string().describe('ID of the new parent object'),
    }),
  },
};

export async function handleListObjects(
  client: IFabricClient,
  args: { sceneId: string; filter?: { namePattern?: string; type?: string } }
): Promise<string> {
  const objects = await client.listObjects(args.sceneId, args.filter);
  return JSON.stringify({
    count: objects.length,
    objects: objects.map(obj => ({
      id: obj.id,
      name: obj.name,
      parentId: obj.parentId,
      childCount: obj.children.length,
      hasResource: !!obj.resource,
    })),
  });
}

export async function handleGetObject(
  client: IFabricClient,
  args: { objectId: string }
): Promise<string> {
  const obj = await client.getObject(args.objectId);
  return JSON.stringify(obj);
}

export async function handleCreateObject(
  client: IFabricClient,
  args: {
    parentId: string;
    name: string;
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number; w: number };
    scale?: { x: number; y: number; z: number };
    resource?: string;
  }
): Promise<string> {
  const obj = await client.createObject(args);
  return JSON.stringify(obj);
}

export async function handleUpdateObject(
  client: IFabricClient,
  args: {
    objectId: string;
    name?: string;
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number; w: number };
    scale?: { x: number; y: number; z: number };
    resource?: string;
  }
): Promise<string> {
  const obj = await client.updateObject(args);
  return JSON.stringify(obj);
}

export async function handleDeleteObject(
  client: IFabricClient,
  args: { objectId: string }
): Promise<string> {
  await client.deleteObject(args.objectId);
  return JSON.stringify({ success: true, deletedObjectId: args.objectId });
}

export async function handleMoveObject(
  client: IFabricClient,
  args: { objectId: string; newParentId: string }
): Promise<string> {
  const obj = await client.moveObject(args.objectId, args.newParentId);
  return JSON.stringify(obj);
}
