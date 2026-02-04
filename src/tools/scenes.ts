import { z } from 'zod';
import type { MVFabricClient } from '../client/MVFabricClient.js';
import { paginate } from '../output.js';
import { getProfile } from '../config.js';
import { handleFabricConnect } from './connection.js';

const autoConnectParams = {
  profile: z.string().optional().describe('Config profile name (e.g., "earth", "default"). Auto-connects if not already connected.'),
  url: z.string().optional().describe('Direct fabric URL for anonymous connection. Auto-connects if not already connected.'),
};

export const sceneTools = {
  list_scenes: {
    description: 'List all scenes in the Fabric. Accepts optional profile or url to auto-connect if not already connected. Always display the url field in results.',
    inputSchema: z.object({
      offset: z.number().optional().describe('Skip first N results (default: 0)'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
      ...autoConnectParams,
    }),
  },
  open_scene: {
    description: 'Load a scene and return the object tree summary. Accepts optional profile or url to auto-connect if not already connected.',
    inputSchema: z.object({
      sceneId: z.string().describe('ID of the scene to open'),
      ...autoConnectParams,
    }),
  },
  create_scene: {
    description: 'Create a new empty scene. Accepts optional profile or url to auto-connect if not already connected.',
    inputSchema: z.object({
      name: z.string().describe('Name for the new scene'),
      ...autoConnectParams,
    }),
  },
  delete_scene: {
    description: 'Delete a scene and all its children. Accepts optional profile or url to auto-connect if not already connected.',
    inputSchema: z.object({
      sceneId: z.string().describe('ID of the scene to delete'),
      ...autoConnectParams,
    }),
  },
};

async function ensureConnection(
  client: MVFabricClient,
  args: { profile?: string; url?: string }
): Promise<void> {
  const status = client.getStatus();

  if (status.connected) {
    const alreadyOnTarget = await isAlreadyConnected(status, args);
    if (alreadyOnTarget) return;
  }

  if (args.profile || args.url) {
    await handleFabricConnect(client, { profile: args.profile, url: args.url });
    return;
  }

  if (!status.connected) {
    throw new Error('Not connected to a Fabric server. Provide a profile or url to auto-connect, or call fabric_connect first.');
  }
}

async function isAlreadyConnected(
  status: { fabricUrl: string | null },
  args: { profile?: string; url?: string }
): Promise<boolean> {
  if (args.profile) {
    const profile = await getProfile(args.profile);
    return status.fabricUrl === profile.fabricUrl;
  }
  if (args.url) {
    return status.fabricUrl === args.url;
  }
  return true;
}

export async function handleListScenes(
  client: MVFabricClient,
  args: { offset?: number; limit?: number; profile?: string; url?: string }
): Promise<string> {
  await ensureConnection(client, args);
  const scenes = await client.listScenes();
  const rootUrl = client.getResourceRootUrl();
  const items = scenes.map(s => {
    const url = rootUrl ? `${rootUrl}/fabric/${s.classId}/${s.id}` : undefined;
    return { id: s.id, name: s.name, url };
  });
  return JSON.stringify(paginate(items, args.offset, args.limit));
}

export async function handleOpenScene(
  client: MVFabricClient,
  args: { sceneId: string; profile?: string; url?: string }
): Promise<string> {
  await ensureConnection(client, args);
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
  args: { name: string; profile?: string; url?: string }
): Promise<string> {
  await ensureConnection(client, args);
  const scene = await client.createScene(args.name);

  const rootUrl = client.getResourceRootUrl();
  let url: string | undefined;
  if (rootUrl) {
    const scenes = await client.listScenes();
    const created = scenes.find(s => s.id === scene.id);
    const classId = created?.classId ?? 73;
    url = `${rootUrl}/fabric/${classId}/${scene.id}`;
  }

  return JSON.stringify({ scene: { ...scene, url } });
}

export async function handleDeleteScene(
  client: MVFabricClient,
  args: { sceneId: string; profile?: string; url?: string }
): Promise<string> {
  await ensureConnection(client, args);
  await client.deleteScene(args.sceneId);
  return JSON.stringify({ success: true, deletedSceneId: args.sceneId });
}
