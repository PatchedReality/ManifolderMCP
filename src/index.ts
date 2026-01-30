#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { MVFabricClient } from './client/MVFabricClient.js';
import { getProfile } from './config.js';
import { ScpStorage } from './storage/ScpStorage.js';

import {
  connectionTools,
  handleListProfiles,
  handleFabricConnect,
  handleFabricDisconnect,
  handleFabricStatus,
  sceneTools,
  handleListScenes,
  handleOpenScene,
  handleCreateScene,
  handleDeleteScene,
  objectTools,
  handleListObjects,
  handleGetObject,
  handleCreateObject,
  handleUpdateObject,
  handleDeleteObject,
  handleDeleteObjectUnknownType,
  handleMoveObject,
  bulkTools,
  handleBulkUpdate,
  handleFindObjects,
  resourceTools,
  handleUploadResource,
  handleListResources,
  handleDeleteResource,
  handleMoveResource,
  handleBulkUploadResources,
  handleBulkDeleteResources,
  handleBulkMoveResources,
  handleDownloadResource,
  handleBulkDownloadResources,
  actionResourceTools,
  handleGetActionResourceSchema,
  handleValidateActionResource,
  type ActionResourceType,
} from './tools/index.js';

const server = new Server(
  {
    name: 'fabric-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

const client = new MVFabricClient();
let storage: ScpStorage | null = null;

async function getStorage(): Promise<ScpStorage> {
  if (!storage) {
    const profile = await getProfile('default');
    storage = new ScpStorage(profile);
  }
  return storage;
}

const allTools = {
  ...connectionTools,
  ...sceneTools,
  ...objectTools,
  ...bulkTools,
  ...resourceTools,
  ...actionResourceTools,
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: Object.entries(allTools).map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema),
    })),
  };
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const AGENT_GUIDE_PATH = join(__dirname, '..', 'src', 'agent-guide.md');

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'fabric://guide',
        name: 'Fabric MCP Agent Guide',
        description: 'Workflows and patterns for AI agents: action resources, object manipulation, bulk operations',
        mimeType: 'text/markdown',
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'fabric://guide') {
    const content = readFileSync(AGENT_GUIDE_PATH, 'utf-8');
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: content,
        },
      ],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      // Connection tools
      case 'list_profiles':
        result = await handleListProfiles();
        break;
      case 'fabric_connect':
        result = await handleFabricConnect(client, args as { profile?: string; url?: string });
        break;
      case 'fabric_disconnect':
        result = await handleFabricDisconnect(client);
        break;
      case 'fabric_status':
        result = handleFabricStatus(client);
        break;

      // Scene tools
      case 'list_scenes':
        result = await handleListScenes(client);
        break;
      case 'open_scene':
        result = await handleOpenScene(client, args as { sceneId: string });
        break;
      case 'create_scene':
        result = await handleCreateScene(client, args as { name: string });
        break;
      case 'delete_scene':
        result = await handleDeleteScene(client, args as { sceneId: string });
        break;

      // Object tools
      case 'list_objects':
        result = await handleListObjects(client, args as Parameters<typeof handleListObjects>[1]);
        break;
      case 'get_object':
        result = await handleGetObject(client, args as { objectId: string });
        break;
      case 'create_object':
        result = await handleCreateObject(client, args as Parameters<typeof handleCreateObject>[1]);
        break;
      case 'update_object':
        result = await handleUpdateObject(client, args as Parameters<typeof handleUpdateObject>[1]);
        break;
      case 'delete_object':
        result = await handleDeleteObject(client, args as { objectId: string });
        break;
      case 'delete_object_unknown_type':
        result = await handleDeleteObjectUnknownType(client, args as { objectId: string });
        break;
      case 'move_object':
        result = await handleMoveObject(client, args as { objectId: string; newParentId: string });
        break;

      // Bulk tools
      case 'bulk_update':
        result = await handleBulkUpdate(client, args as Parameters<typeof handleBulkUpdate>[1]);
        break;
      case 'find_objects':
        result = await handleFindObjects(client, args as Parameters<typeof handleFindObjects>[1]);
        break;

      // Resource tools
      case 'upload_resource':
        result = await handleUploadResource(await getStorage(), args as Parameters<typeof handleUploadResource>[1]);
        break;
      case 'list_resources':
        result = await handleListResources(await getStorage(), args as { path?: string; filter?: string; recursive?: boolean });
        break;
      case 'delete_resource':
        result = await handleDeleteResource(await getStorage(), args as { resourceName: string });
        break;
      case 'move_resource':
        result = await handleMoveResource(await getStorage(), args as { sourceName: string; destName: string });
        break;
      case 'bulk_upload_resources':
        result = await handleBulkUploadResources(await getStorage(), args as Parameters<typeof handleBulkUploadResources>[1]);
        break;
      case 'bulk_delete_resources':
        result = await handleBulkDeleteResources(await getStorage(), args as Parameters<typeof handleBulkDeleteResources>[1]);
        break;
      case 'bulk_move_resources':
        result = await handleBulkMoveResources(await getStorage(), args as Parameters<typeof handleBulkMoveResources>[1]);
        break;
      case 'download_resource':
        result = await handleDownloadResource(await getStorage(), args as { resourceName: string; localPath: string });
        break;
      case 'bulk_download_resources':
        result = await handleBulkDownloadResources(await getStorage(), args as Parameters<typeof handleBulkDownloadResources>[1]);
        break;

      // Action resource tools
      case 'get_action_resource_schema':
        result = handleGetActionResourceSchema();
        break;
      case 'validate_action_resource':
        result = await handleValidateActionResource(args as { localPath: string; type: ActionResourceType });
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Fabric MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
