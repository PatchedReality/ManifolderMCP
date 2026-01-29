import { z } from 'zod';
import type { ScpStorage } from '../storage/ScpStorage.js';

export const resourceTools = {
  upload_resource: {
    description: 'Upload a resource file to the Fabric server. Resources can be: 3D models (.glb), images (.png, .jpg), or template resource JSON files (for reusable scene fragments, lights, text, etc.).',
    inputSchema: z.object({
      filePath: z.string().describe('Local path to the file to upload'),
      targetName: z.string().optional().describe('Target filename (defaults to source filename)'),
    }),
  },
  list_resources: {
    description: 'List available resources on the server. Resources include 3D models (.glb), images (.png, .jpg), and template resource JSON files.',
    inputSchema: z.object({
      filter: z.string().optional().describe('Filter pattern (e.g., "*.glb", "*.json")'),
    }),
  },
  delete_resource: {
    description: 'Remove a resource file from the server. Can delete any resource type: 3D models, images, or template resource JSON files.',
    inputSchema: z.object({
      resourceName: z.string().describe('Name of the resource to delete'),
    }),
  },
  move_resource: {
    description: 'Move or rename a resource on the server. Creates destination directories as needed. Can move any resource type: 3D models, images, or template resource JSON files.',
    inputSchema: z.object({
      sourceName: z.string().describe('Current name/path of the resource'),
      destName: z.string().describe('New name/path for the resource'),
    }),
  },
};

export async function handleUploadResource(
  storage: ScpStorage,
  args: { filePath: string; targetName?: string }
): Promise<string> {
  const result = await storage.upload(args.filePath, args.targetName);
  return JSON.stringify(result);
}

export async function handleListResources(
  storage: ScpStorage,
  args: { filter?: string }
): Promise<string> {
  const resources = await storage.list(args.filter);
  return JSON.stringify({
    count: resources.length,
    resources,
  });
}

export async function handleDeleteResource(
  storage: ScpStorage,
  args: { resourceName: string }
): Promise<string> {
  await storage.delete(args.resourceName);
  return JSON.stringify({ success: true, deletedResource: args.resourceName });
}

export async function handleMoveResource(
  storage: ScpStorage,
  args: { sourceName: string; destName: string }
): Promise<string> {
  const result = await storage.move(args.sourceName, args.destName);
  return JSON.stringify(result);
}
