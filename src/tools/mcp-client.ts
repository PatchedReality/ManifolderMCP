/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IManifolderPromiseClient } from '../client/index.js';
import type {
  EarthAttachmentParentResult,
  BulkOperation,
  BulkUpdateOptions,
  CreateObjectParams,
  FabricObject,
  MutatedObject,
  FollowAttachmentResult,
  FindEarthAttachmentParentParams,
  Scene,
  SearchQuery,
  ScopeInfo,
  ScopeStatus,
  UpdateObjectParams,
} from '../types.js';

export interface ManifolderMCPClient {
  listScopes(): ScopeInfo[];
  getScopeStatus(args: { scopeId: string }): ScopeStatus;
  connectRoot(args: { fabricUrl: string; adminKey?: string; timeoutMs?: number }): Promise<{ scopeId: string }>;
  closeScope(args: { scopeId: string; cascade?: boolean }): Promise<{ closedScopeIds: string[] }>;
  followAttachment(args: { scopeId: string; objectId: string; autoOpenRoot?: boolean }): Promise<FollowAttachmentResult>;
  getResourceRootUrl(args: { scopeId: string }): string;
  listScenes(args: { scopeId: string }): Promise<Scene[]>;
  openScene(args: { scopeId: string; sceneId: string }): Promise<FabricObject>;
  createScene(args: { scopeId: string; name: string; objectType?: string }): Promise<Scene>;
  deleteScene(args: { scopeId: string; sceneId: string }): Promise<void>;
  listObjects(args: { scopeId: string; anchorObjectId: string; filter?: { namePattern?: string; type?: string } }): Promise<FabricObject[]>;
  getObject(args: { scopeId: string; objectId: string }): Promise<FabricObject>;
  createObject(args: { scopeId: string } & Omit<CreateObjectParams, 'skipParentRefetch' | 'tolerateTimeout' | 'mutationTimeoutMs' | 'skipConfirmation'>): Promise<MutatedObject>;
  updateObject(args: { scopeId: string } & Omit<UpdateObjectParams, 'skipRefetch' | 'tolerateTimeout' | 'mutationTimeoutMs' | 'skipConfirmation'>): Promise<MutatedObject>;
  deleteObject(args: { scopeId: string; objectId: string }): Promise<{ confirmed: boolean }>;
  moveObject(args: { scopeId: string; objectId: string; newParentId: string }): Promise<MutatedObject>;
  bulkUpdate(args: { scopeId: string; operations: BulkOperation[]; options?: BulkUpdateOptions }): Promise<{
    success: number;
    failed: number;
    createdIds: string[];
    errors: string[];
    results: Array<
      | { status: 'ok'; id?: string; confirmed: boolean }
      | { status: 'error'; message: string }
    >;
  }>;
  findObjects(args: { scopeId: string; anchorObjectId?: string; query: SearchQuery }): Promise<FabricObject[]>;
  findEarthAttachmentParent(args: { scopeId: string; anchorObjectId?: string } & FindEarthAttachmentParentParams): Promise<EarthAttachmentParentResult>;
}

export function asMCPClient(client: IManifolderPromiseClient): ManifolderMCPClient {
  return client as unknown as ManifolderMCPClient;
}
