import { z } from 'zod';
import type { ScpStorage } from '../storage/ScpStorage.js';
import { paginate } from '../output.js';
import { resolveProfileTarget } from './scope-target.js';

export const resourceTools = {
  upload_resource: {
    description: 'Upload a resource file to the Fabric server. Resources can be: 3D models (.glb), images (.png, .jpg), or action resource JSON files (for lights, text, rotators, video).',
    inputSchema: z.object({
      profile: z.string().describe('Config profile name (e.g., "earth", "default")'),
      localPath: z.string().describe('Local path to the file to upload'),
      targetName: z.string().optional().describe('Target filename (defaults to source filename)'),
    }).strict(),
  },
  list_resources: {
    description: 'List available resources on the server. Resources include 3D models (.glb), images (.png, .jpg), and action resource JSON files.',
    inputSchema: z.object({
      profile: z.string().describe('Config profile name (e.g., "earth", "default")'),
      path: z.string().optional().describe('Subdirectory path to list (e.g., "Forest/Trees"). Defaults to root.'),
      filter: z.string().optional().describe('Glob pattern using * as wildcard. Examples: "*.glb" (files ending in .glb), "tree*" (files starting with tree), "*forest*" (files containing forest). Case-insensitive.'),
      recursive: z.boolean().optional().describe('If true, recursively list all subdirectories. Defaults to false.'),
      offset: z.number().optional().describe('Skip first N results (default: 0)'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
    }).strict(),
  },
  delete_resource: {
    description: 'Remove a resource file from the server. Can delete any resource type: 3D models, images, or action resource JSON files.',
    inputSchema: z.object({
      profile: z.string().describe('Config profile name (e.g., "earth", "default")'),
      resourceName: z.string().describe('Name of the resource to delete'),
    }).strict(),
  },
  move_resource: {
    description: 'Move or rename a resource on the server. Creates destination directories as needed. Can move any resource type: 3D models, images, or action resource JSON files.',
    inputSchema: z.object({
      profile: z.string().describe('Config profile name (e.g., "earth", "default")'),
      sourceName: z.string().describe('Current name/path of the resource'),
      destName: z.string().describe('New name/path for the resource'),
    }).strict(),
  },
  bulk_upload_resources: {
    description: 'Upload multiple resource files in a single operation. More efficient than multiple upload_resource calls.',
    inputSchema: z.object({
      profile: z.string().describe('Config profile name (e.g., "earth", "default")'),
      files: z.array(z.object({
        localPath: z.string().describe('Local path to the file'),
        targetName: z.string().optional().describe('Target filename (defaults to source filename)'),
      })).describe('Array of files to upload'),
    }).strict(),
  },
  bulk_delete_resources: {
    description: 'Delete multiple resources in a single operation. More efficient than multiple delete_resource calls.',
    inputSchema: z.object({
      profile: z.string().describe('Config profile name (e.g., "earth", "default")'),
      resourceNames: z.array(z.string()).describe('Array of resource names to delete'),
    }).strict(),
  },
  bulk_move_resources: {
    description: 'Move or rename multiple resources in a single operation. More efficient than multiple move_resource calls.',
    inputSchema: z.object({
      profile: z.string().describe('Config profile name (e.g., "earth", "default")'),
      moves: z.array(z.object({
        sourceName: z.string().describe('Current name/path of the resource'),
        destName: z.string().describe('New name/path for the resource'),
      })).describe('Array of move operations'),
    }).strict(),
  },
  download_resource: {
    description: 'Download a resource file from the server to a local path.',
    inputSchema: z.object({
      profile: z.string().describe('Config profile name (e.g., "earth", "default")'),
      resourceName: z.string().describe('Name/path of the resource on the server'),
      localPath: z.string().describe('Local path to save the file to'),
    }).strict(),
  },
  bulk_download_resources: {
    description: 'Download multiple resource files in a single operation. More efficient than multiple download_resource calls.',
    inputSchema: z.object({
      profile: z.string().describe('Config profile name (e.g., "earth", "default")'),
      downloads: z.array(z.object({
        resourceName: z.string().describe('Name/path of the resource on the server'),
        localPath: z.string().describe('Local path to save the file to'),
      })).describe('Array of download operations'),
    }).strict(),
  },
};

export async function handleUploadResource(
  storage: ScpStorage,
  args: { profile: string; localPath: string; targetName?: string }
): Promise<string> {
  await resolveProfileTarget(args);
  const result = await storage.upload(args.localPath, args.targetName);
  return JSON.stringify({ ...result, profile: args.profile });
}

export async function handleListResources(
  storage: ScpStorage,
  args: { profile: string; path?: string; filter?: string; recursive?: boolean; offset?: number; limit?: number }
): Promise<string> {
  await resolveProfileTarget(args);
  const resources = await storage.list(args.path, args.filter, args.recursive);
  const items = resources.map((r: any) => ({
    name: r.name ?? r,
    url: r.url ?? null,
    profile: args.profile,
  }));
  return JSON.stringify(paginate(items, args.offset, args.limit));
}

export async function handleDeleteResource(
  storage: ScpStorage,
  args: { profile: string; resourceName: string }
): Promise<string> {
  await resolveProfileTarget(args);
  await storage.delete(args.resourceName);
  return JSON.stringify({ success: true, profile: args.profile, deletedResource: args.resourceName });
}

export async function handleMoveResource(
  storage: ScpStorage,
  args: { profile: string; sourceName: string; destName: string }
): Promise<string> {
  await resolveProfileTarget(args);
  const result = await storage.move(args.sourceName, args.destName);
  return JSON.stringify({ ...result, profile: args.profile });
}

export async function handleBulkUploadResources(
  storage: ScpStorage,
  args: { profile: string; files: Array<{ localPath: string; targetName?: string }> }
): Promise<string> {
  await resolveProfileTarget(args);
  const result = await storage.bulkUpload(args.files);
  return JSON.stringify({
    profile: args.profile,
    successCount: result.success.length,
    failedCount: result.failed.length,
    failedItems: result.failed,
  });
}

export async function handleBulkDeleteResources(
  storage: ScpStorage,
  args: { profile: string; resourceNames: string[] }
): Promise<string> {
  await resolveProfileTarget(args);
  const result = await storage.bulkDelete(args.resourceNames);
  return JSON.stringify({
    profile: args.profile,
    deletedCount: result.deleted.length,
    failedCount: result.failed.length,
    skippedCount: result.skipped.length,
    failedItems: result.failed,
  });
}

export async function handleBulkMoveResources(
  storage: ScpStorage,
  args: { profile: string; moves: Array<{ sourceName: string; destName: string }> }
): Promise<string> {
  await resolveProfileTarget(args);
  const result = await storage.bulkMove(args.moves);
  return JSON.stringify({
    profile: args.profile,
    movedCount: result.moved.length,
    failedCount: result.failed.length,
    skippedCount: result.skipped.length,
    failedItems: result.failed,
  });
}

export async function handleDownloadResource(
  storage: ScpStorage,
  args: { profile: string; resourceName: string; localPath: string }
): Promise<string> {
  await resolveProfileTarget(args);
  const result = await storage.download(args.resourceName, args.localPath);
  return JSON.stringify({ ...result, profile: args.profile });
}

export async function handleBulkDownloadResources(
  storage: ScpStorage,
  args: { profile: string; downloads: Array<{ resourceName: string; localPath: string }> }
): Promise<string> {
  await resolveProfileTarget(args);
  const result = await storage.bulkDownload(args.downloads);
  return JSON.stringify({
    profile: args.profile,
    successCount: result.success.length,
    failedCount: result.failed.length,
    failedItems: result.failed,
  });
}
