// MVMF Class IDs
export const ClassIds = {
  RMRoot: 70,
  RMCObject: 71,
  RMTObject: 72,
  RMPObject: 73,
} as const;

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Transform {
  position: Vector3;
  rotation: Quaternion;
  scale: Vector3;
}

export interface BoundingBox {
  min: Vector3;
  max: Vector3;
}

export interface RMPObject {
  id: string;
  parentId: string | null;
  name: string;
  transform: Transform;
  resource: string | null;
  resourceName: string | null;
  bound: BoundingBox | null;
  classId: number;
  children: string[] | null;
}

export interface Scene {
  id: string;
  name: string;
  rootObjectId: string;
}

export interface ObjectFilter {
  namePattern?: string;
  type?: string;
}

export interface SearchQuery {
  namePattern?: string;
  positionRadius?: { center: Vector3; radius: number };
  resourceUrl?: string;
}

export interface CreateObjectParams {
  parentId: string;
  name: string;
  position?: Vector3;
  rotation?: Quaternion;
  scale?: Vector3;
  resource?: string;
  resourceName?: string;
  bound?: Vector3;
}

export interface UpdateObjectParams {
  objectId: string;
  name?: string;
  position?: Vector3;
  rotation?: Quaternion;
  scale?: Vector3;
  resource?: string;
}

export interface BulkOperation {
  type: 'create' | 'update' | 'delete' | 'move';
  params: CreateObjectParams | UpdateObjectParams | { objectId: string } | { objectId: string; newParentId: string };
}

export interface ConnectionStatus {
  connected: boolean;
  fabricUrl: string | null;
  currentSceneId: string | null;
  currentSceneName: string | null;
  resourceRootUrl: string | null;
}
