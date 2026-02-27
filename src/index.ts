#!/usr/bin/env node
/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

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

import {
  createManifolderPromiseClient,
} from './client/index.js';
import type { IManifolderPromiseClient } from './client/index.js';
import { getProfile } from './config.js';
import { ScpStorage } from './storage/ScpStorage.js';

import {
  connectionTools,
  handleListProfiles,
  handleFabricStatus,
  scopeTools,
  handleListScopes,
  handleFollowAttachment,
  handleCloseScope,
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
  handleFindObjects,
  bulkTools,
  handleBulkUpdate,
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
  getFullActionResourceSchema,
  handleValidateActionResource,
  type ActionResourceType,
  resolveProfileTarget,
} from './tools/index.js';
import { serializeToolError } from './tools/errors.js';

const server = new Server(
  {
    name: 'manifolder-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

const client: IManifolderPromiseClient = createManifolderPromiseClient();
const storageByProfile = new Map<string, ScpStorage>();

async function getStorage(profileName: string): Promise<ScpStorage> {
  if (!profileName) {
    throw new Error('profile is required');
  }
  const existing = storageByProfile.get(profileName);
  if (existing) {
    return existing;
  }
  const profile = await getProfile(profileName);
  const storage = new ScpStorage(profile);
  storageByProfile.set(profileName, storage);
  return storage;
}

async function resolveResourceProfileName(args: unknown): Promise<string> {
  const resolved = await resolveProfileTarget((args ?? {}) as Parameters<typeof resolveProfileTarget>[0]);
  return resolved.profileName;
}

const allTools = {
  ...connectionTools,
  ...scopeTools,
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
        uri: 'manifolder://guide',
        name: 'Manifolder MCP Agent Guide',
        description: 'Workflows and patterns for AI agents: action resources, object manipulation, bulk operations',
        mimeType: 'text/markdown',
      },
      {
        uri: 'manifolder://action-schema',
        name: 'Action Resource Schema',
        description: 'Full schema for action resources (lights, text, rotators, video)',
        mimeType: 'application/json',
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'manifolder://guide') {
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

  if (uri === 'manifolder://action-schema') {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: getFullActionResourceSchema(),
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
      case 'fabric_status':
        result = await handleFabricStatus(client, args as Parameters<typeof handleFabricStatus>[1]);
        break;

      // Scope tools
      case 'list_scopes':
        result = await handleListScopes(client, args as Parameters<typeof handleListScopes>[1]);
        break;
      case 'follow_attachment':
        result = await handleFollowAttachment(client, args as Parameters<typeof handleFollowAttachment>[1]);
        break;
      case 'close_scope':
        result = await handleCloseScope(client, args as Parameters<typeof handleCloseScope>[1]);
        break;

      // Scene tools
      case 'list_scenes':
        result = await handleListScenes(client, args as Parameters<typeof handleListScenes>[1]);
        break;
      case 'open_scene':
        result = await handleOpenScene(client, args as Parameters<typeof handleOpenScene>[1]);
        break;
      case 'create_scene':
        result = await handleCreateScene(client, args as Parameters<typeof handleCreateScene>[1]);
        break;
      case 'delete_scene':
        result = await handleDeleteScene(client, args as Parameters<typeof handleDeleteScene>[1]);
        break;

      // Object tools
      case 'list_objects':
        result = await handleListObjects(client, args as Parameters<typeof handleListObjects>[1]);
        break;
      case 'get_object':
        result = await handleGetObject(client, args as Parameters<typeof handleGetObject>[1]);
        break;
      case 'create_object':
        result = await handleCreateObject(client, args as Parameters<typeof handleCreateObject>[1]);
        break;
      case 'update_object':
        result = await handleUpdateObject(client, args as Parameters<typeof handleUpdateObject>[1]);
        break;
      case 'delete_object':
        result = await handleDeleteObject(client, args as Parameters<typeof handleDeleteObject>[1]);
        break;
      case 'move_object':
        result = await handleMoveObject(client, args as Parameters<typeof handleMoveObject>[1]);
        break;
      case 'find_objects':
        result = await handleFindObjects(client, args as Parameters<typeof handleFindObjects>[1]);
        break;

      // Bulk tools
      case 'bulk_update':
        result = await handleBulkUpdate(client, args as Parameters<typeof handleBulkUpdate>[1]);
        break;

      // Resource tools
      case 'upload_resource':
        result = await handleUploadResource(
          await getStorage(await resolveResourceProfileName(args)),
          args as Parameters<typeof handleUploadResource>[1]
        );
        break;
      case 'list_resources':
        result = await handleListResources(
          await getStorage(await resolveResourceProfileName(args)),
          args as Parameters<typeof handleListResources>[1]
        );
        break;
      case 'delete_resource':
        result = await handleDeleteResource(
          await getStorage(await resolveResourceProfileName(args)),
          args as Parameters<typeof handleDeleteResource>[1]
        );
        break;
      case 'move_resource':
        result = await handleMoveResource(
          await getStorage(await resolveResourceProfileName(args)),
          args as Parameters<typeof handleMoveResource>[1]
        );
        break;
      case 'bulk_upload_resources':
        result = await handleBulkUploadResources(
          await getStorage(await resolveResourceProfileName(args)),
          args as Parameters<typeof handleBulkUploadResources>[1]
        );
        break;
      case 'bulk_delete_resources':
        result = await handleBulkDeleteResources(
          await getStorage(await resolveResourceProfileName(args)),
          args as Parameters<typeof handleBulkDeleteResources>[1]
        );
        break;
      case 'bulk_move_resources':
        result = await handleBulkMoveResources(
          await getStorage(await resolveResourceProfileName(args)),
          args as Parameters<typeof handleBulkMoveResources>[1]
        );
        break;
      case 'download_resource':
        result = await handleDownloadResource(
          await getStorage(await resolveResourceProfileName(args)),
          args as Parameters<typeof handleDownloadResource>[1]
        );
        break;
      case 'bulk_download_resources':
        result = await handleBulkDownloadResources(
          await getStorage(await resolveResourceProfileName(args)),
          args as Parameters<typeof handleBulkDownloadResources>[1]
        );
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
    const payload = serializeToolError(error);
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Manifolder MCP server running on stdio');
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
