import { z } from 'zod';
import type { MVFabricClient } from '../client/MVFabricClient.js';
import { paginate } from '../output.js';

export const sceneTools = {
  list_scenes: {
    description: 'List all scenes in the Fabric',
    inputSchema: z.object({
      offset: z.number().optional().describe('Skip first N results (default: 0)'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
    }),
  },
  open_scene: {
    description: 'Load a scene and return the object tree summary',
    inputSchema: z.object({
      sceneId: z.string().describe('ID of the scene to open'),
    }),
  },
  create_scene: {
    description: 'Create a new empty scene',
    inputSchema: z.object({
      name: z.string().describe('Name for the new scene'),
    }),
  },
  delete_scene: {
    description: 'Delete a scene and all its children',
    inputSchema: z.object({
      sceneId: z.string().describe('ID of the scene to delete'),
    }),
  },
};

export async function handleListScenes(
  client: MVFabricClient,
  args: { offset?: number; limit?: number }
): Promise<string> {
  const scenes = await client.listScenes();
  const items = scenes.map(s => ({ id: s.id, name: s.name }));
  return JSON.stringify(paginate(items, args.offset, args.limit));
}

export async function handleOpenScene(
  client: MVFabricClient,
  args: { sceneId: string }
): Promise<string> {
  const root = await client.openScene(args.sceneId);
  const childCount = root.children === null ? -1 : root.children.length;

  let children: Array<{ id: string; name: string; hasResource: boolean }> | undefined;
  if (root.children && root.children.length > 0) {
    const childDetails = await Promise.all(
      root.children.map(id => client.getObject(id).catch(() => null))
    );
    children = childDetails
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map(c => ({ id: c.id, name: c.name, hasResource: !!c.resource }));
  }

  return JSON.stringify({
    sceneId: args.sceneId,
    root: { id: root.id, name: root.name, childCount },
    children,
  });
}

export async function handleCreateScene(
  client: MVFabricClient,
  args: { name: string }
): Promise<string> {
  const scene = await client.createScene(args.name);
  return JSON.stringify({ scene });
}

export async function handleDeleteScene(
  client: MVFabricClient,
  args: { sceneId: string }
): Promise<string> {
  await client.deleteScene(args.sceneId);
  return JSON.stringify({ success: true, deletedSceneId: args.sceneId });
}
