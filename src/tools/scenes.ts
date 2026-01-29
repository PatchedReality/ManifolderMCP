import { z } from 'zod';
import type { IFabricClient } from '../client/IFabricClient.js';

export const sceneTools = {
  list_scenes: {
    description: 'List all scenes in the Fabric',
    inputSchema: z.object({}),
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

export async function handleListScenes(client: IFabricClient): Promise<string> {
  const scenes = await client.listScenes();
  return JSON.stringify({ scenes });
}

export async function handleOpenScene(
  client: IFabricClient,
  args: { sceneId: string }
): Promise<string> {
  const root = await client.openScene(args.sceneId);
  return JSON.stringify({
    sceneId: args.sceneId,
    root: {
      id: root.id,
      name: root.name,
      childCount: root.children.length,
    },
  });
}

export async function handleCreateScene(
  client: IFabricClient,
  args: { name: string }
): Promise<string> {
  const scene = await client.createScene(args.name);
  return JSON.stringify({ scene });
}

export async function handleDeleteScene(
  client: IFabricClient,
  args: { sceneId: string }
): Promise<string> {
  await client.deleteScene(args.sceneId);
  return JSON.stringify({ success: true, deletedSceneId: args.sceneId });
}
