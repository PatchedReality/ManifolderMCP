import type { IManifolderPromiseClient } from '../client/index.js';
import type {
  BulkOperation,
  CreateObjectParams,
  FabricObject,
  FollowAttachmentResult,
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
  createObject(args: { scopeId: string } & Omit<CreateObjectParams, 'skipParentRefetch'>): Promise<FabricObject>;
  updateObject(args: { scopeId: string } & Omit<UpdateObjectParams, 'skipRefetch'>): Promise<FabricObject>;
  deleteObject(args: { scopeId: string; objectId: string }): Promise<void>;
  moveObject(args: { scopeId: string; objectId: string; newParentId: string }): Promise<FabricObject>;
  bulkUpdate(args: { scopeId: string; operations: BulkOperation[] }): Promise<{
    success: number;
    failed: number;
    createdIds: string[];
    errors: string[];
  }>;
  findObjects(args: { scopeId: string; anchorObjectId: string; query: SearchQuery }): Promise<FabricObject[]>;
}

export function asMCPClient(client: IManifolderPromiseClient): ManifolderMCPClient {
  return client as unknown as ManifolderMCPClient;
}
