import { z } from 'zod';
import type { ScpStorage } from '../storage/ScpStorage.js';

export const resourceTools = {
  upload_resource: {
    description: 'Upload a .glb, .png, or other file to the Fabric server\'s objects directory',
    inputSchema: z.object({
      filePath: z.string().describe('Local path to the file to upload'),
      targetName: z.string().optional().describe('Target filename (defaults to source filename)'),
    }),
  },
  list_resources: {
    description: 'List available resources on the server',
    inputSchema: z.object({
      filter: z.string().optional().describe('Filter pattern (e.g., "*.glb")'),
    }),
  },
  delete_resource: {
    description: 'Remove a resource file from the server',
    inputSchema: z.object({
      resourceName: z.string().describe('Name of the resource to delete'),
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
