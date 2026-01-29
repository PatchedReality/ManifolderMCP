import type {
  BulkOperation,
  ConnectionStatus,
  CreateObjectParams,
  ObjectFilter,
  RMPObject,
  Scene,
  SearchQuery,
  UpdateObjectParams,
} from '../types.js';

export interface IFabricClient {
  // Connection
  connect(fabricUrl: string, adminKey: string): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): ConnectionStatus;

  // Scenes
  listScenes(): Promise<Scene[]>;
  openScene(sceneId: string): Promise<RMPObject>;
  createScene(name: string): Promise<Scene>;
  deleteScene(sceneId: string): Promise<void>;

  // Objects
  listObjects(sceneId: string, filter?: ObjectFilter): Promise<RMPObject[]>;
  getObject(objectId: string): Promise<RMPObject>;
  createObject(params: CreateObjectParams): Promise<RMPObject>;
  updateObject(params: UpdateObjectParams): Promise<RMPObject>;
  deleteObject(objectId: string): Promise<void>;
  moveObject(objectId: string, newParentId: string): Promise<RMPObject>;

  // Bulk Operations
  bulkUpdate(operations: BulkOperation[]): Promise<{ success: number; failed: number; errors: string[] }>;
  findObjects(sceneId: string, query: SearchQuery): Promise<RMPObject[]>;
}
