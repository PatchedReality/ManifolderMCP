import { z } from 'zod';
import type { MVFabricClient } from '../client/MVFabricClient.js';
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
    description: 'Create a new object in the scene. For regular 3D models, use resource="/objects/Model.glb". For template resources, use resource="action://scene" with resourceName="/objects/template.json".',
    inputSchema: z.object({
      parentId: z.string().describe('ID of the parent object'),
      name: z.string().describe('Name for the new object'),
      position: vector3Schema.optional().describe('Position (default: 0,0,0)'),
      rotation: quaternionSchema.optional().describe('Rotation quaternion (default: identity)'),
      scale: vector3Schema.optional().describe('Scale (default: 1,1,1)'),
      resource: z.string().optional().describe('For .glb models: "/objects/Model.glb". For templates: "action://scene"'),
      resourceName: z.string().optional().describe('For template resources only: path to the JSON file, e.g. "/objects/template.json"'),
      bound: vector3Schema.optional().describe('Bounding box size (default: 1,1,1). For templates, set to match objectBounds.'),
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
    description: 'Delete an object and its children. Object must be in cache (loaded via get_object or list_objects first).',
    inputSchema: z.object({
      objectId: z.string().describe('ID of the object to delete'),
    }),
  },
  delete_object_unknown_type: {
    description: 'Delete an object when its type is unknown (not in cache). Queries the server trying multiple object types. Use only when delete_object fails due to object not being in cache.',
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
  client: MVFabricClient,
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
  client: MVFabricClient,
  args: { objectId: string }
): Promise<string> {
  const obj = await client.getObject(args.objectId);
  const resolvedResourceUrl = client.resolveResourceName(obj.resourceName);
  return JSON.stringify({ ...obj, resolvedResourceUrl });
}

export async function handleCreateObject(
  client: MVFabricClient,
  args: {
    parentId: string;
    name: string;
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number; w: number };
    scale?: { x: number; y: number; z: number };
    resource?: string;
    resourceName?: string;
    bound?: { x: number; y: number; z: number };
  }
): Promise<string> {
  const obj = await client.createObject(args);
  return JSON.stringify(obj);
}

export async function handleUpdateObject(
  client: MVFabricClient,
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
  client: MVFabricClient,
  args: { objectId: string }
): Promise<string> {
  await client.deleteObject(args.objectId, false);
  return JSON.stringify({ success: true, deletedObjectId: args.objectId });
}

export async function handleDeleteObjectUnknownType(
  client: MVFabricClient,
  args: { objectId: string }
): Promise<string> {
  await client.deleteObject(args.objectId, true);
  return JSON.stringify({ success: true, deletedObjectId: args.objectId });
}

export async function handleMoveObject(
  client: MVFabricClient,
  args: { objectId: string; newParentId: string }
): Promise<string> {
  const obj = await client.moveObject(args.objectId, args.newParentId);
  return JSON.stringify(obj);
}
