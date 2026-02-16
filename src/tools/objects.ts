import { z } from 'zod';
import type { MVFabricClient } from '../client/MVFabricClient.js';
import type { CreateObjectParams, UpdateObjectParams } from '../types.js';
import { objectTypeSchema, transformFields, celestialFields, vector3Schema } from './schemas.js';
import { paginate } from '../output.js';

export const objectTools = {
  list_objects: {
    description: 'List already-loaded objects in a scene (shallow). Objects whose children have not been loaded yet will show childCount: -1. Use get_object to load a specific object and its children, or find_objects to deep-search.',
    inputSchema: z.object({
      scopeId: z.string().describe('Object ID to scope the listing to. Typically a scene root from list_scenes, but can be any object. (e.g., "physical:1", "terrestrial:3")'),
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
      objectId: z.string().describe('ID of the object (e.g., "physical:42", "terrestrial:3")'),
    }),
  },
  create_object: {
    description: 'Create a new object in the scene. For regular 3D models, set resourceReference to the url returned by upload_resource or list_resources. For action resources (lights, text, rotators, video), set resourceReference to the action URI and resourceName to the uploaded JSON config url.',
    inputSchema: z.object({
      parentId: z.string().describe('ID of the parent object (e.g., "physical:123", "terrestrial:3", or "root")'),
      name: z.string().describe('Name for the new object'),
      ...transformFields,
      ...celestialFields,
      objectType: objectTypeSchema.optional().describe('Object type in "class:subtype" format. Examples: "terrestrial:sector", "terrestrial:parcel", "celestial:planet", "physical:transport". Defaults to "physical" when omitted. Use parentId "root" to create under RMRoot.'),
    }),
  },
  update_object: {
    description: 'Update properties of an existing object',
    inputSchema: z.object({
      objectId: z.string().describe('ID of the object to update (e.g., "physical:42", "terrestrial:3")'),
      name: z.string().optional().describe('New name'),
      ...transformFields,
      ...celestialFields,
    }),
  },
  delete_object: {
    description: 'Delete an object and its children. The object class is derived from the prefixed ID.',
    inputSchema: z.object({
      objectId: z.string().describe('ID of the object to delete (e.g., "physical:42", "terrestrial:3")'),
    }),
  },
  move_object: {
    description: 'Reparent an object to a new parent',
    inputSchema: z.object({
      objectId: z.string().describe('ID of the object to move (e.g., "physical:42")'),
      newParentId: z.string().describe('ID of the new parent object (e.g., "terrestrial:3")'),
    }),
  },
};

export async function handleListObjects(
  client: MVFabricClient,
  args: { scopeId: string; filter?: { namePattern?: string; type?: string }; offset?: number; limit?: number }
): Promise<string> {
  const objects = await client.listObjects(args.scopeId, args.filter);
  const items = objects.map(obj => ({
    id: obj.id,
    name: obj.name,
    parentId: obj.parentId,
    childCount: obj.children === null ? -1 : obj.children.length,
    hasResource: !!obj.resourceReference,
  }));
  return JSON.stringify(paginate(items, args.offset, args.limit));
}

export async function handleGetObject(
  client: MVFabricClient,
  args: { objectId: string }
): Promise<string> {
  const obj = await client.getObject(args.objectId);

  const result: Record<string, any> = {
    id: obj.id,
    name: obj.name,
    parentId: obj.parentId,
    position: obj.transform.position,
    rotation: obj.transform.rotation,
    scale: obj.transform.scale,
    resourceReference: obj.resourceReference,
    resourceName: obj.resourceName,
    childCount: obj.children === null ? -1 : obj.children.length,
    children: obj.children,
  };
  if (obj.orbit) result.orbit = obj.orbit;
  if (obj.properties) result.properties = obj.properties;
  return JSON.stringify(result);
}

export async function handleCreateObject(
  client: MVFabricClient,
  args: Omit<CreateObjectParams, 'skipParentRefetch'>
): Promise<string> {
  const obj = await client.createObject(args);
  return JSON.stringify({ id: obj.id, name: obj.name, parentId: obj.parentId });
}

export async function handleUpdateObject(
  client: MVFabricClient,
  args: Omit<UpdateObjectParams, 'skipRefetch'>
): Promise<string> {
  const updated: string[] = [];
  if (args.name !== undefined) updated.push('name');
  if (args.position !== undefined) updated.push('position');
  if (args.rotation !== undefined) updated.push('rotation');
  if (args.scale !== undefined) updated.push('scale');
  if (args.resourceReference !== undefined) updated.push('resourceReference');
  if (args.resourceName !== undefined) updated.push('resourceName');
  if (args.bound !== undefined) updated.push('bound');
  if (args.orbit !== undefined) updated.push('orbit');
  if (args.properties !== undefined) updated.push('properties');
  await client.updateObject(args);
  return JSON.stringify({ id: args.objectId, updated });
}

export async function handleDeleteObject(
  client: MVFabricClient,
  args: { objectId: string }
): Promise<string> {
  await client.deleteObject(args.objectId);
  return JSON.stringify({ success: true, deletedObjectId: args.objectId });
}

export async function handleMoveObject(
  client: MVFabricClient,
  args: { objectId: string; newParentId: string }
): Promise<string> {
  await client.moveObject(args.objectId, args.newParentId);
  return JSON.stringify({ id: args.objectId, newParentId: args.newParentId });
}
