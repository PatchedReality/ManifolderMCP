import { z } from 'zod';
import type { MVFabricClient } from '../client/MVFabricClient.js';
import { objectTypeSchema, quaternionSchema, vector3Schema } from './schemas.js';
import { paginate } from '../output.js';
import type { ObjectType } from '../types.js';

export const objectTools = {
  list_objects: {
    description: 'List already-loaded objects in a scene (shallow). Objects whose children have not been loaded yet will show childCount: -1. Use get_object to load a specific object and its children, or find_objects to deep-search.',
    inputSchema: z.object({
      sceneId: z.string().describe('ID of the scene'),
      filter: z.object({
        namePattern: z.string().optional().describe('Regex pattern to filter by name'),
        type: z.string().optional().describe('Object type to filter by'),
      }).optional().describe('Optional filter criteria'),
      offset: z.number().optional().describe('Skip first N results (default: 0)'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
    }),
  },
  get_object: {
    description: 'Get full details of a specific object',
    inputSchema: z.object({
      objectId: z.string().describe('ID of the object'),
    }),
  },
  create_object: {
    description: 'Create a new object in the scene. For regular 3D models, use resource="/objects/Model.glb". For action resources (lights, text, rotators, video), set resource to the action URI and resourceName to the action resource JSON file.',
    inputSchema: z.object({
      parentId: z.string().describe('ID of the parent object'),
      name: z.string().describe('Name for the new object'),
      position: vector3Schema.optional().describe('Position (default: 0,0,0)'),
      rotation: quaternionSchema.optional().describe('Rotation quaternion (default: identity)'),
      scale: vector3Schema.optional().describe('Scale (default: 1,1,1)'),
      resource: z.string().optional().describe('Resource URL, e.g. "/objects/Model.glb" or an action URI like "action://pointlight"'),
      resourceName: z.string().optional().describe('Path to the action resource JSON file when using an action URI, e.g. "/objects/my-light.json"'),
      bound: vector3Schema.optional().describe('Bounding box size (default: 1,1,1)'),
      objectType: objectTypeSchema.optional().describe('Object type: "parcel" creates a Terrestrial parcel (class 72, bType 10), "terrestrial-root" creates a Terrestrial root (class 72, bType 1), others create Physical objects (class 73, bType 0). Default: Physical object'),
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
  args: { sceneId: string; filter?: { namePattern?: string; type?: string }; offset?: number; limit?: number }
): Promise<string> {
  const objects = await client.listObjects(args.sceneId, args.filter);
  const items = objects.map(obj => ({
    id: obj.id,
    name: obj.name,
    parentId: obj.parentId,
    childCount: obj.children === null ? -1 : obj.children.length,
    hasResource: !!obj.resource,
  }));
  return JSON.stringify(paginate(items, args.offset, args.limit));
}

export async function handleGetObject(
  client: MVFabricClient,
  args: { objectId: string }
): Promise<string> {
  const obj = await client.getObject(args.objectId);

  return JSON.stringify({
    id: obj.id,
    name: obj.name,
    parentId: obj.parentId,
    position: obj.transform.position,
    rotation: obj.transform.rotation,
    scale: obj.transform.scale,
    resource: obj.resource,
    resourceName: obj.resourceName,
    childCount: obj.children === null ? -1 : obj.children.length,
    children: obj.children,
  });
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
    objectType?: ObjectType;
  }
): Promise<string> {
  const obj = await client.createObject(args);
  return JSON.stringify({ id: obj.id, name: obj.name, parentId: obj.parentId });
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
  const updated: string[] = [];
  if (args.name !== undefined) updated.push('name');
  if (args.position !== undefined) updated.push('position');
  if (args.rotation !== undefined) updated.push('rotation');
  if (args.scale !== undefined) updated.push('scale');
  if (args.resource !== undefined) updated.push('resource');
  await client.updateObject(args);
  return JSON.stringify({ id: args.objectId, updated });
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
  await client.moveObject(args.objectId, args.newParentId);
  return JSON.stringify({ id: args.objectId, newParentId: args.newParentId });
}
