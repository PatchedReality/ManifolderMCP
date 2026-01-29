import type { IFabricClient } from './IFabricClient.js';
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
import { ClassIds } from '../types.js';

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function defaultTransform() {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

export class MockFabricClient implements IFabricClient {
  private connected = false;
  private profile: string | null = null;
  private fabricUrl: string | null = null;
  private currentSceneId: string | null = null;

  private scenes: Map<string, Scene> = new Map();
  private objects: Map<string, RMPObject> = new Map();

  constructor() {
    this.initMockData();
  }

  private initMockData() {
    const scene1Id = 'scene-001';
    const scene1RootId = 'root-001';

    this.scenes.set(scene1Id, {
      id: scene1Id,
      name: 'Demo Scene',
      rootObjectId: scene1RootId,
    });

    const scene2Id = 'scene-002';
    const scene2RootId = 'root-002';

    this.scenes.set(scene2Id, {
      id: scene2Id,
      name: 'Test Scene',
      rootObjectId: scene2RootId,
    });

    this.objects.set(scene1RootId, {
      id: scene1RootId,
      parentId: null,
      name: 'Demo Scene Root',
      transform: defaultTransform(),
      resource: null,
      bound: null,
      classId: ClassIds.RMRoot,
      children: ['obj-001', 'obj-002'],
    });

    this.objects.set('obj-001', {
      id: 'obj-001',
      parentId: scene1RootId,
      name: 'Cube',
      transform: {
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      resource: 'https://example.com/objects/Cube.glb',
      bound: { min: { x: -0.5, y: -0.5, z: -0.5 }, max: { x: 0.5, y: 0.5, z: 0.5 } },
      classId: ClassIds.RMPObject,
      children: [],
    });

    this.objects.set('obj-002', {
      id: 'obj-002',
      parentId: scene1RootId,
      name: 'Sphere',
      transform: {
        position: { x: 3, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      resource: 'https://example.com/objects/Sphere.glb',
      bound: { min: { x: -0.5, y: -0.5, z: -0.5 }, max: { x: 0.5, y: 0.5, z: 0.5 } },
      classId: ClassIds.RMPObject,
      children: ['obj-003'],
    });

    this.objects.set('obj-003', {
      id: 'obj-003',
      parentId: 'obj-002',
      name: 'Child Object',
      transform: {
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 0.5, y: 0.5, z: 0.5 },
      },
      resource: null,
      bound: null,
      classId: ClassIds.RMPObject,
      children: [],
    });

    this.objects.set(scene2RootId, {
      id: scene2RootId,
      parentId: null,
      name: 'Test Scene Root',
      transform: defaultTransform(),
      resource: null,
      bound: null,
      classId: ClassIds.RMRoot,
      children: [],
    });
  }

  async connect(fabricUrl: string, _adminKey: string): Promise<void> {
    await this.simulateLatency();
    this.connected = true;
    this.fabricUrl = fabricUrl;
    this.profile = 'default';
  }

  async disconnect(): Promise<void> {
    await this.simulateLatency();
    this.connected = false;
    this.fabricUrl = null;
    this.profile = null;
    this.currentSceneId = null;
  }

  getStatus(): ConnectionStatus {
    const scene = this.currentSceneId ? this.scenes.get(this.currentSceneId) : null;
    return {
      connected: this.connected,
      profile: this.profile,
      fabricUrl: this.fabricUrl,
      currentSceneId: this.currentSceneId,
      currentSceneName: scene?.name ?? null,
    };
  }

  async listScenes(): Promise<Scene[]> {
    this.ensureConnected();
    await this.simulateLatency();
    return Array.from(this.scenes.values());
  }

  async openScene(sceneId: string): Promise<RMPObject> {
    this.ensureConnected();
    await this.simulateLatency();

    const scene = this.scenes.get(sceneId);
    if (!scene) {
      throw new Error(`Scene not found: ${sceneId}`);
    }

    this.currentSceneId = sceneId;

    const root = this.objects.get(scene.rootObjectId);
    if (!root) {
      throw new Error(`Root object not found for scene: ${sceneId}`);
    }

    return root;
  }

  async createScene(name: string): Promise<Scene> {
    this.ensureConnected();
    await this.simulateLatency();

    const sceneId = `scene-${generateId()}`;
    const rootId = `root-${generateId()}`;

    const scene: Scene = {
      id: sceneId,
      name,
      rootObjectId: rootId,
    };

    const root: RMPObject = {
      id: rootId,
      parentId: null,
      name: `${name} Root`,
      transform: defaultTransform(),
      resource: null,
      bound: null,
      classId: ClassIds.RMRoot,
      children: [],
    };

    this.scenes.set(sceneId, scene);
    this.objects.set(rootId, root);

    return scene;
  }

  async deleteScene(sceneId: string): Promise<void> {
    this.ensureConnected();
    await this.simulateLatency();

    const scene = this.scenes.get(sceneId);
    if (!scene) {
      throw new Error(`Scene not found: ${sceneId}`);
    }

    this.deleteObjectRecursive(scene.rootObjectId);
    this.scenes.delete(sceneId);

    if (this.currentSceneId === sceneId) {
      this.currentSceneId = null;
    }
  }

  async listObjects(sceneId: string, filter?: ObjectFilter): Promise<RMPObject[]> {
    this.ensureConnected();
    await this.simulateLatency();

    const scene = this.scenes.get(sceneId);
    if (!scene) {
      throw new Error(`Scene not found: ${sceneId}`);
    }

    const result: RMPObject[] = [];
    this.collectObjects(scene.rootObjectId, result);

    if (filter?.namePattern) {
      const pattern = new RegExp(filter.namePattern, 'i');
      return result.filter(obj => pattern.test(obj.name));
    }

    return result;
  }

  async getObject(objectId: string): Promise<RMPObject> {
    this.ensureConnected();
    await this.simulateLatency();

    const obj = this.objects.get(objectId);
    if (!obj) {
      throw new Error(`Object not found: ${objectId}`);
    }

    return obj;
  }

  async createObject(params: CreateObjectParams): Promise<RMPObject> {
    this.ensureConnected();
    await this.simulateLatency();

    const parent = this.objects.get(params.parentId);
    if (!parent) {
      throw new Error(`Parent object not found: ${params.parentId}`);
    }

    const objectId = `obj-${generateId()}`;
    const obj: RMPObject = {
      id: objectId,
      parentId: params.parentId,
      name: params.name,
      transform: {
        position: params.position ?? { x: 0, y: 0, z: 0 },
        rotation: params.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
        scale: params.scale ?? { x: 1, y: 1, z: 1 },
      },
      resource: params.resource ?? null,
      bound: null,
      classId: ClassIds.RMPObject,
      children: [],
    };

    this.objects.set(objectId, obj);
    parent.children.push(objectId);

    return obj;
  }

  async updateObject(params: UpdateObjectParams): Promise<RMPObject> {
    this.ensureConnected();
    await this.simulateLatency();

    const obj = this.objects.get(params.objectId);
    if (!obj) {
      throw new Error(`Object not found: ${params.objectId}`);
    }

    if (params.name !== undefined) {
      obj.name = params.name;
    }
    if (params.position !== undefined) {
      obj.transform.position = params.position;
    }
    if (params.rotation !== undefined) {
      obj.transform.rotation = params.rotation;
    }
    if (params.scale !== undefined) {
      obj.transform.scale = params.scale;
    }
    if (params.resource !== undefined) {
      obj.resource = params.resource;
    }

    return obj;
  }

  async deleteObject(objectId: string): Promise<void> {
    this.ensureConnected();
    await this.simulateLatency();

    const obj = this.objects.get(objectId);
    if (!obj) {
      throw new Error(`Object not found: ${objectId}`);
    }

    if (obj.classId === ClassIds.RMRoot) {
      throw new Error('Cannot delete root object');
    }

    if (obj.parentId) {
      const parent = this.objects.get(obj.parentId);
      if (parent) {
        parent.children = parent.children.filter(id => id !== objectId);
      }
    }

    this.deleteObjectRecursive(objectId);
  }

  async moveObject(objectId: string, newParentId: string): Promise<RMPObject> {
    this.ensureConnected();
    await this.simulateLatency();

    const obj = this.objects.get(objectId);
    if (!obj) {
      throw new Error(`Object not found: ${objectId}`);
    }

    const newParent = this.objects.get(newParentId);
    if (!newParent) {
      throw new Error(`New parent not found: ${newParentId}`);
    }

    if (obj.parentId) {
      const oldParent = this.objects.get(obj.parentId);
      if (oldParent) {
        oldParent.children = oldParent.children.filter(id => id !== objectId);
      }
    }

    obj.parentId = newParentId;
    newParent.children.push(objectId);

    return obj;
  }

  async bulkUpdate(operations: BulkOperation[]): Promise<{ success: number; failed: number; errors: string[] }> {
    this.ensureConnected();

    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const op of operations) {
      try {
        switch (op.type) {
          case 'create':
            await this.createObject(op.params as CreateObjectParams);
            break;
          case 'update':
            await this.updateObject(op.params as UpdateObjectParams);
            break;
          case 'delete':
            await this.deleteObject((op.params as { objectId: string }).objectId);
            break;
          case 'move':
            const moveParams = op.params as { objectId: string; newParentId: string };
            await this.moveObject(moveParams.objectId, moveParams.newParentId);
            break;
        }
        success++;
      } catch (error) {
        failed++;
        errors.push(`${op.type} failed: ${(error as Error).message}`);
      }
    }

    return { success, failed, errors };
  }

  async findObjects(sceneId: string, query: SearchQuery): Promise<RMPObject[]> {
    this.ensureConnected();
    await this.simulateLatency();

    const allObjects = await this.listObjects(sceneId);

    return allObjects.filter(obj => {
      if (query.namePattern && !new RegExp(query.namePattern, 'i').test(obj.name)) {
        return false;
      }
      if (query.resourceUrl && obj.resource !== query.resourceUrl) {
        return false;
      }
      if (query.positionRadius) {
        const { center, radius } = query.positionRadius;
        const pos = obj.transform.position;
        const dist = Math.sqrt(
          Math.pow(pos.x - center.x, 2) +
          Math.pow(pos.y - center.y, 2) +
          Math.pow(pos.z - center.z, 2)
        );
        if (dist > radius) {
          return false;
        }
      }
      return true;
    });
  }

  private ensureConnected() {
    if (!this.connected) {
      throw new Error('Not connected. Call fabric_connect first.');
    }
  }

  private async simulateLatency(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  private collectObjects(objectId: string, result: RMPObject[]) {
    const obj = this.objects.get(objectId);
    if (!obj) return;

    result.push(obj);
    for (const childId of obj.children) {
      this.collectObjects(childId, result);
    }
  }

  private deleteObjectRecursive(objectId: string) {
    const obj = this.objects.get(objectId);
    if (!obj) return;

    for (const childId of obj.children) {
      this.deleteObjectRecursive(childId);
    }

    this.objects.delete(objectId);
  }
}
