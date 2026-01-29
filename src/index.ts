#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { MVFabricClient } from './client/MVFabricClient.js';
import type { IFabricClient } from './client/IFabricClient.js';
import { getProfile } from './config.js';
import { ScpStorage } from './storage/ScpStorage.js';

import {
  connectionTools,
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
  handleMoveObject,
  bulkTools,
  handleBulkUpdate,
  handleFindObjects,
  resourceTools,
  handleUploadResource,
  handleListResources,
  handleDeleteResource,
} from './tools/index.js';

const server = new Server(
  {
    name: 'fabric-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const client: IFabricClient = new MVFabricClient();
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      // Connection tools
      case 'fabric_connect':
        result = await handleFabricConnect(client, args as { profile?: string });
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
        result = await handleListResources(await getStorage(), args as { filter?: string });
        break;
      case 'delete_resource':
        result = await handleDeleteResource(await getStorage(), args as { resourceName: string });
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
