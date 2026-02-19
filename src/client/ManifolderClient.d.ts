import type {
  BulkOperation,
  ConnectionStatus,
  CreateObjectParams,
  ObjectFilter,
  FabricObject,
  Scene,
  SearchQuery,
  UpdateObjectParams,
} from '../types.js';

export interface IManifolderClientCommon {
  connected: boolean;
  connect(url: string, adminKeyOrOptions?: string | { adminKey?: string; timeoutMs?: number }, timeoutMs?: number): Promise<any>;
  disconnect(): Promise<void>;
  getResourceRootUrl(): string;
}

export interface IManifolderSubscriptionClient extends IManifolderClientCommon {
  on(event: string, handler: (data: any) => void): void;
  off(event: string, handler: (data: any) => void): void;
  openModel(opts: { sID: string; twObjectIx: number }): void;
  closeModel(opts: { sID: string; twObjectIx: number }): void;
  subscribe(opts: { sID: string; twObjectIx: number }): void;
  enumerateChildren(model: any): any[];
  searchNodes(searchText: string): Promise<any>;
}

export interface IManifolderPromiseClient extends IManifolderClientCommon {
  getStatus(): ConnectionStatus;
  listScenes(): Promise<Scene[]>;
  openScene(sceneId: string): Promise<FabricObject>;
  createScene(name: string, objectType?: string): Promise<Scene>;
  deleteScene(sceneId: string): Promise<void>;
  listObjects(scopeId: string, filter?: ObjectFilter): Promise<FabricObject[]>;
  getObject(objectId: string): Promise<FabricObject>;
  createObject(params: CreateObjectParams): Promise<FabricObject>;
  updateObject(params: UpdateObjectParams): Promise<FabricObject>;
  deleteObject(objectId: string): Promise<void>;
  moveObject(objectId: string, newParentId: string, skipRefetch?: boolean): Promise<FabricObject>;
  bulkUpdate(operations: BulkOperation[]): Promise<{ success: number; failed: number; createdIds: string[]; errors: string[] }>;
  findObjects(scopeId: string, query: SearchQuery): Promise<FabricObject[]>;
}

export declare class ManifolderClient implements IManifolderSubscriptionClient, IManifolderPromiseClient {
  connected: boolean;
  constructor();

  connect(url: string, adminKeyOrOptions?: string | { adminKey?: string; timeoutMs?: number }, timeoutMs?: number): Promise<any>;
  disconnect(): Promise<void>;

  on(event: string, handler: (data: any) => void): void;
  off(event: string, handler: (data: any) => void): void;

  openModel(opts: { sID: string; twObjectIx: number }): void;
  closeModel(opts: { sID: string; twObjectIx: number }): void;
  subscribe(opts: { sID: string; twObjectIx: number }): void;
  enumerateChildren(model: any): any[];
  searchNodes(searchText: string): Promise<any>;

  getStatus(): ConnectionStatus;
  getResourceRootUrl(): string;

  listScenes(): Promise<Scene[]>;
  openScene(sceneId: string): Promise<FabricObject>;
  createScene(name: string, objectType?: string): Promise<Scene>;
  deleteScene(sceneId: string): Promise<void>;

  listObjects(scopeId: string, filter?: ObjectFilter): Promise<FabricObject[]>;
  getObject(objectId: string): Promise<FabricObject>;
  createObject(params: CreateObjectParams): Promise<FabricObject>;
  updateObject(params: UpdateObjectParams): Promise<FabricObject>;
  deleteObject(objectId: string): Promise<void>;
  moveObject(objectId: string, newParentId: string, skipRefetch?: boolean): Promise<FabricObject>;
  bulkUpdate(operations: BulkOperation[]): Promise<{ success: number; failed: number; createdIds: string[]; errors: string[] }>;
  findObjects(scopeId: string, query: SearchQuery): Promise<FabricObject[]>;
}

export declare function asManifolderSubscriptionClient(
  client: ManifolderClient,
): IManifolderSubscriptionClient;
export declare function asManifolderPromiseClient(
  client: ManifolderClient,
): IManifolderPromiseClient;
export declare function createManifolderSubscriptionClient(): IManifolderSubscriptionClient;
export declare function createManifolderPromiseClient(): IManifolderPromiseClient;

export declare class MVFabricClient extends ManifolderClient {}
export declare class MVClient extends ManifolderClient {}
