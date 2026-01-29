import { z } from 'zod';
import type { ScpStorage } from '../storage/ScpStorage.js';

export const resourceTools = {
  upload_resource: {
    description: 'Upload a resource file to the Fabric server. Resources can be: 3D models (.glb), images (.png, .jpg), or template resource JSON files (for reusable scene fragments, lights, text, etc.).',
    inputSchema: z.object({
      localPath: z.string().describe('Local path to the file to upload'),
      targetName: z.string().optional().describe('Target filename (defaults to source filename)'),
    }),
  },
  list_resources: {
    description: 'List available resources on the server. Resources include 3D models (.glb), images (.png, .jpg), and template resource JSON files.',
    inputSchema: z.object({
      path: z.string().optional().describe('Subdirectory path to list (e.g., "Forest/Trees"). Defaults to root.'),
      filter: z.string().optional().describe('Glob pattern using * as wildcard. Examples: "*.glb" (files ending in .glb), "tree*" (files starting with tree), "*forest*" (files containing forest). Case-insensitive.'),
      recursive: z.boolean().optional().describe('If true, recursively list all subdirectories. Defaults to false.'),
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
  bulk_upload_resources: {
    description: 'Upload multiple resource files in a single operation. More efficient than multiple upload_resource calls.',
    inputSchema: z.object({
      files: z.array(z.object({
        localPath: z.string().describe('Local path to the file'),
        targetName: z.string().optional().describe('Target filename (defaults to source filename)'),
      })).describe('Array of files to upload'),
    }),
  },
  bulk_delete_resources: {
    description: 'Delete multiple resources in a single operation. More efficient than multiple delete_resource calls.',
    inputSchema: z.object({
      resourceNames: z.array(z.string()).describe('Array of resource names to delete'),
    }),
  },
  bulk_move_resources: {
    description: 'Move or rename multiple resources in a single operation. More efficient than multiple move_resource calls.',
    inputSchema: z.object({
      moves: z.array(z.object({
        sourceName: z.string().describe('Current name/path of the resource'),
        destName: z.string().describe('New name/path for the resource'),
      })).describe('Array of move operations'),
    }),
  },
  download_resource: {
    description: 'Download a resource file from the server to a local path.',
    inputSchema: z.object({
      resourceName: z.string().describe('Name/path of the resource on the server'),
      localPath: z.string().describe('Local path to save the file to'),
    }),
  },
  bulk_download_resources: {
    description: 'Download multiple resource files in a single operation. More efficient than multiple download_resource calls.',
    inputSchema: z.object({
      downloads: z.array(z.object({
        resourceName: z.string().describe('Name/path of the resource on the server'),
        localPath: z.string().describe('Local path to save the file to'),
      })).describe('Array of download operations'),
    }),
  },
};

export async function handleUploadResource(
  storage: ScpStorage,
  args: { localPath: string; targetName?: string }
): Promise<string> {
  const result = await storage.upload(args.localPath, args.targetName);
  return JSON.stringify(result);
}

export async function handleListResources(
  storage: ScpStorage,
  args: { path?: string; filter?: string; recursive?: boolean }
): Promise<string> {
  const resources = await storage.list(args.path, args.filter, args.recursive);
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

export async function handleBulkUploadResources(
  storage: ScpStorage,
  args: { files: Array<{ localPath: string; targetName?: string }> }
): Promise<string> {
  const result = await storage.bulkUpload(args.files);
  return JSON.stringify({
    successCount: result.success.length,
    failedCount: result.failed.length,
    ...result,
  });
}

export async function handleBulkDeleteResources(
  storage: ScpStorage,
  args: { resourceNames: string[] }
): Promise<string> {
  const result = await storage.bulkDelete(args.resourceNames);
  return JSON.stringify({
    deletedCount: result.deleted.length,
    failedCount: result.failed.length,
    skippedCount: result.skipped.length,
    ...result,
  });
}

export async function handleBulkMoveResources(
  storage: ScpStorage,
  args: { moves: Array<{ sourceName: string; destName: string }> }
): Promise<string> {
  const result = await storage.bulkMove(args.moves);
  return JSON.stringify({
    movedCount: result.moved.length,
    failedCount: result.failed.length,
    skippedCount: result.skipped.length,
    ...result,
  });
}

export async function handleDownloadResource(
  storage: ScpStorage,
  args: { resourceName: string; localPath: string }
): Promise<string> {
  const result = await storage.download(args.resourceName, args.localPath);
  return JSON.stringify(result);
}

export async function handleBulkDownloadResources(
  storage: ScpStorage,
  args: { downloads: Array<{ resourceName: string; localPath: string }> }
): Promise<string> {
  const result = await storage.bulkDownload(args.downloads);
  return JSON.stringify({
    successCount: result.success.length,
    failedCount: result.failed.length,
    ...result,
  });
}
