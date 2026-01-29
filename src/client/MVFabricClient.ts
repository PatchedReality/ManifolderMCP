// @ts-nocheck - MVMF libraries are untyped JavaScript
import '../vendor/mv/index.js';
import { appendFileSync } from 'fs';

const DEBUG_LOG = '/tmp/fabric-mcp-debug.log';
function debugLog(msg: string) {
  appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
}

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

declare const MV: any;

export class MVFabricClient extends MV.MVMF.NOTIFICATION {
  private pFabric: any = null;
  private pLnG: any = null;
  private pRMRoot: any = null;
  private connected = false;
  private loggedIn = false;
  private profile: string | null = null;
  private fabricUrl: string | null = null;
  private currentSceneId: string | null = null;
  private adminKey: string | null = null;
  private loginAttempted = false;

  private objectCache: Map<string, any> = new Map();
  private sceneClassIds: Map<string, number> = new Map();
  private pendingReady: Map<string, { resolve: () => void; reject: (err: Error) => void }> = new Map();
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;

  private getObjectName(pObject: any): string {
    return pObject.pName?.wsRMPObjectId
      || pObject.pName?.wsRMTObjectId
      || pObject.pName?.wsRMCObjectId
      || `Object ${pObject.twObjectIx}`;
  }

  private getObjectKey(pObject: any): string {
    return `${pObject.wClass_Object || pObject.sID || 'unknown'}:${pObject.twObjectIx || 0}`;
  }

  private waitForReady(pObject: any, timeoutMs: number = 30000): Promise<void> {
    if (pObject.IsReady()) {
      return Promise.resolve();
    }
    if (pObject.ReadyState?.() === pObject.eSTATE?.ERROR) {
      return Promise.reject(new Error('Object in error state'));
    }
    const key = this.getObjectKey(pObject);
    debugLog(`[waitForReady] registering key=${key} sID=${pObject.sID} wClass=${pObject.wClass_Object} twObj=${pObject.twObjectIx}`);
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingReady.delete(key);
        debugLog(`[waitForReady] TIMEOUT key=${key}`);
        reject(new Error(`Timeout waiting for object to be ready (key: ${key}, state: ${pObject.ReadyState?.()})`));
      }, timeoutMs);

      this.pendingReady.set(key, {
        resolve: () => { clearTimeout(timeoutId); resolve(); },
        reject: (err: Error) => { clearTimeout(timeoutId); reject(err); }
      });
    });
  }

  onReadyState(pNotice: any) {
    this.handleReadyState(pNotice);

    const pObject = pNotice.pCreator;
    if (!pObject) return;

    const key = this.getObjectKey(pObject);
    const isReady = pObject.IsReady?.();
    const state = pObject.ReadyState?.();
    debugLog(`[onReadyState] key=${key} isReady=${isReady} state=${state} sID=${pObject.sID} wClass=${pObject.wClass_Object} twObj=${pObject.twObjectIx} pendingKeys=[${[...this.pendingReady.keys()].join(',')}]`);

    const pending = this.pendingReady.get(key);
    if (pending) {
      if (isReady) {
        this.pendingReady.delete(key);
        pending.resolve();
      } else if (state === pObject.eSTATE?.ERROR) {
        this.pendingReady.delete(key);
        pending.reject(new Error('Object failed to load'));
      }
    }
  }

  onInserted(pNotice: any) {
    const pChild = pNotice.pData?.pChild;
    const pParent = pNotice.pCreator;
    debugLog(`[onInserted] parent=${pParent?.twObjectIx} parentClass=${pParent?.wClass_Object} child=${pChild?.twObjectIx} childClass=${pChild?.wClass_Object} childName=${pChild?.pName?.wsRMPObjectId || pChild?.pName?.wsRMTObjectId || pChild?.pName?.wsRMCObjectId}`);
    if (pChild?.twObjectIx) {
      this.objectCache.set(pChild.twObjectIx.toString(), pChild);
    }
  }

  onUpdated(pNotice: any) {
    const pChild = pNotice.pData?.pChild;
    if (pChild?.twObjectIx) {
      this.objectCache.set(pChild.twObjectIx.toString(), pChild);
    }
  }

  onChanged(pNotice: any) {
    this.onUpdated(pNotice);
  }

  onDeleting(pNotice: any) {
    const pChild = pNotice.pData?.pChild;
    if (pChild?.twObjectIx) {
      const id = pChild.twObjectIx.toString();
      this.objectCache.delete(id);
    }
  }

  async connect(fabricUrl: string, adminKey: string): Promise<void> {
    this.fabricUrl = fabricUrl;
    this.adminKey = adminKey;
    this.loginAttempted = false;

    return new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;

      this.pFabric = new MV.MVRP.MSF(fabricUrl, MV.MVRP.MSF.eMETHOD.GET);
      this.pFabric.Attach(this);
    });
  }

  private handleReadyState(pNotice: any) {
    if (pNotice.pCreator === this.pFabric) {
      if (this.pFabric.IsReady()) {
        this.pLnG = this.pFabric.GetLnG('map');
        if (!this.pLnG) {
          this.connectReject?.(new Error('Failed to get LnG "map" from fabric config'));
          return;
        }
        this.pLnG.Attach(this);
      } else if (this.pFabric.ReadyState() === this.pFabric.eSTATE.ERROR) {
        this.connectReject?.(new Error('Failed to load fabric config from ' + this.fabricUrl));
      }
    } else if (pNotice.pCreator === this.pLnG) {
      const state = this.pLnG.ReadyState();
      if (state === this.pLnG.eSTATE.LOGGEDIN) {
        const wasConnected = this.connected;
        this.connected = true;
        this.loggedIn = true;
        this.profile = 'default';
        if (!wasConnected) {
          this.start();
          this.connectResolve?.();
          this.connectResolve = null;
          this.connectReject = null;
        }
      } else if (state === this.pLnG.eSTATE.LOGGEDOUT) {
        if (this.adminKey) {
          if (this.loginAttempted) {
            // Login failed - we tried and came back to LOGGEDOUT
            this.connectReject?.(new Error('Login failed: invalid admin key or authentication error'));
            this.connectResolve = null;
            this.connectReject = null;
          } else {
            // First attempt - try to login
            this.loginAttempted = true;
            this.pLnG.Login('token=' + MV.MVMF.Escape(this.adminKey));
          }
        } else {
          // Anonymous read-only access
          this.connected = true;
          this.loggedIn = false;
          this.profile = 'default';
          this.start();
          this.connectResolve?.();
          this.connectResolve = null;
          this.connectReject = null;
        }
      } else if (state === this.pLnG.eSTATE.DISCONNECTED) {
        if (this.connected) {
          this.connected = false;
          this.loggedIn = false;
        } else {
          this.connectReject?.(new Error('Disconnected from server'));
        }
      }
    }
  }

  private start() {
    this.pRMRoot = this.pLnG.Model_Open('RMRoot', 1);
    this.pRMRoot.Attach(this);
  }

  private async openAndWait(modelType: string, objectId: number, timeoutMs?: number): Promise<any> {
    const pObject = this.pLnG.Model_Open(modelType, objectId);
    if (!pObject) {
      throw new Error(`Failed to open ${modelType} with id ${objectId}`);
    }
    pObject.Attach(this);
    await this.waitForReady(pObject, timeoutMs);
    return pObject;
  }

  private static readonly OBJECT_TYPES = ['RMPObject', 'RMTObject', 'RMCObject'];

  private static readonly CLASS_ID_TO_TYPE: Record<number, string> = {
    [ClassIds.RMPObject]: 'RMPObject',
    [ClassIds.RMTObject]: 'RMTObject',
    [ClassIds.RMCObject]: 'RMCObject',
  };

  private async openWithKnownType(objectId: number, classId: number): Promise<any> {
    const modelType = MVFabricClient.CLASS_ID_TO_TYPE[classId];
    if (!modelType) {
      throw new Error(`Unknown class ID: ${classId}`);
    }
    return await this.openAndWait(modelType, objectId);
  }

  private async openAnyObjectType(objectId: number): Promise<any> {
    for (const modelType of MVFabricClient.OBJECT_TYPES) {
      try {
        return await this.openAndWait(modelType, objectId, 10000);
      } catch {
        // Try next type
      }
    }
    throw new Error(`Could not open object ${objectId} as any known type`);
  }

  private enumAllChildTypes(pObject: any, callback: (child: any) => void): void {
    for (const childType of MVFabricClient.OBJECT_TYPES) {
      pObject.Child_Enum(childType, this, callback, null);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pRMRoot) {
      this.pLnG.Model_Close(this.pRMRoot);
      this.pRMRoot = null;
    }
    if (this.pFabric) {
      await this.pFabric.destructor();
      this.pFabric = null;
    }
    this.pLnG = null;
    this.connected = false;
    this.loggedIn = false;
    this.fabricUrl = null;
    this.profile = null;
    this.currentSceneId = null;
    this.objectCache.clear();
    this.sceneClassIds.clear();
  }

  getStatus(): ConnectionStatus {
    return {
      connected: this.connected,
      profile: this.profile,
      fabricUrl: this.fabricUrl,
      currentSceneId: this.currentSceneId,
      currentSceneName: null,
      resourceRootUrl: this.getResourceRootUrl() || null,
    };
  }

  async listScenes(): Promise<Scene[]> {
    this.ensureConnected();
    await this.waitForReady(this.pRMRoot);

    const scenes: Scene[] = [];
    const seenIds = new Set<string>();
    const enumCallback = (pRMXObject: any) => {
      const id = pRMXObject.twObjectIx.toString();
      if (seenIds.has(id)) return;
      seenIds.add(id);

      const name = this.getObjectName(pRMXObject);
      const classId = pRMXObject.wClass_Object;
      this.sceneClassIds.set(id, classId);
      scenes.push({ id, name, rootObjectId: id });
    };

    this.enumAllChildTypes(this.pRMRoot, enumCallback);
    return scenes;
  }

  async openScene(sceneId: string): Promise<RMPObject> {
    this.ensureConnected();

    const classId = this.sceneClassIds.get(sceneId);
    let pObject: any;
    if (classId && MVFabricClient.CLASS_ID_TO_TYPE[classId]) {
      debugLog(`[openScene] opening scene ${sceneId} with known class ${classId} (${MVFabricClient.CLASS_ID_TO_TYPE[classId]})`);
      pObject = await this.openAndWait(MVFabricClient.CLASS_ID_TO_TYPE[classId], parseInt(sceneId));
    } else {
      debugLog(`[openScene] opening scene ${sceneId} with unknown class, trying all types`);
      pObject = await this.openAnyObjectType(parseInt(sceneId));
    }

    this.currentSceneId = sceneId;
    this.objectCache.set(sceneId, pObject);

    return this.rmxToRMPObject(pObject);
  }

  async createScene(name: string): Promise<Scene> {
    this.ensureConnected();
    await this.waitForReady(this.pRMRoot);

    const response = await this.sendAction(this.pRMRoot, 'RMPOBJECT_OPEN', (payload: any) => {
      payload.pName.wsRMPObjectId = name;
      payload.pType.bType = 1;
      payload.pType.bSubtype = 0;
      payload.pType.bFiction = 0;
      payload.pType.bMovable = 0;
      payload.pOwner.twRPersonaIx = 1;
      payload.pResource.qwResource = 0;
      payload.pResource.sName = '';
      payload.pResource.sReference = '';
      payload.pTransform.vPosition.dX = 0;
      payload.pTransform.vPosition.dY = 0;
      payload.pTransform.vPosition.dZ = 0;
      payload.pTransform.qRotation.dX = 0;
      payload.pTransform.qRotation.dY = 0;
      payload.pTransform.qRotation.dZ = 0;
      payload.pTransform.qRotation.dW = 1;
      payload.pTransform.vScale.dX = 1;
      payload.pTransform.vScale.dY = 1;
      payload.pTransform.vScale.dZ = 1;
      payload.pBound.dX = 150;
      payload.pBound.dY = 150;
      payload.pBound.dZ = 150;
    });

    if (response.nResult !== 0) {
      throw new Error(`Failed to create scene: error ${response.nResult}`);
    }

    const newId = response.aResultSet?.[0]?.[0]?.twRMPObjectIx?.toString() || Date.now().toString();
    return { id: newId, name, rootObjectId: newId };
  }

  async deleteScene(sceneId: string): Promise<void> {
    this.ensureConnected();
    await this.waitForReady(this.pRMRoot);

    const response = await this.sendAction(this.pRMRoot, 'RMPOBJECT_CLOSE', (payload: any) => {
      payload.twRMPObjectIx_Close = parseInt(sceneId);
      payload.bDeleteAll = 1;
    });

    if (response.nResult !== 0) {
      throw new Error(`Failed to delete scene: error ${response.nResult}`);
    }

    if (this.currentSceneId === sceneId) {
      this.currentSceneId = null;
    }
    this.objectCache.delete(sceneId);
  }

  private async openObject(objectId: number, classId?: number): Promise<void> {
    if (classId && MVFabricClient.CLASS_ID_TO_TYPE[classId]) {
      await this.openWithKnownType(objectId, classId);
    } else {
      await this.openAnyObjectType(objectId);
    }
  }

  async listObjects(sceneId: string, filter?: ObjectFilter): Promise<RMPObject[]> {
    this.ensureConnected();

    if (!this.objectCache.has(sceneId)) {
      await this.openAnyObjectType(parseInt(sceneId));
    }

    const objects: RMPObject[] = [];
    const seenIds = new Set<string>();

    const collectLoaded = (pObject: any): void => {
      const id = pObject.twObjectIx.toString();
      if (seenIds.has(id)) return;
      seenIds.add(id);

      objects.push(this.rmxToRMPObject(pObject));

      this.enumAllChildTypes(pObject, (child: any) => {
        collectLoaded(child);
      });
    };

    const pScene = this.objectCache.get(sceneId);
    if (pScene) {
      collectLoaded(pScene);
    }

    if (filter?.namePattern) {
      const pattern = new RegExp(filter.namePattern, 'i');
      return objects.filter(obj => pattern.test(obj.name));
    }

    return objects;
  }

  async getObject(objectId: string): Promise<RMPObject> {
    this.ensureConnected();

    let pObject = this.objectCache.get(objectId);
    if (pObject) {
      // Object is cached but may not have its children loaded yet.
      // If it has children (nChildren > 0) but IsReady is false, open it to fetch children.
      if (!pObject.IsReady?.()) {
        const classId = pObject.wClass_Object;
        if (classId && MVFabricClient.CLASS_ID_TO_TYPE[classId]) {
          debugLog(`[getObject] cached object ${objectId} not ready (class ${classId}), opening to load children`);
          pObject = await this.openAndWait(MVFabricClient.CLASS_ID_TO_TYPE[classId], parseInt(objectId));
          this.objectCache.set(objectId, pObject);
        }
      }
    } else {
      pObject = await this.openAnyObjectType(parseInt(objectId));
      this.objectCache.set(objectId, pObject);
    }

    return this.rmxToRMPObject(pObject);
  }

  async createObject(params: CreateObjectParams): Promise<RMPObject> {
    this.ensureConnected();

    let pParent = this.objectCache.get(params.parentId);
    if (!pParent) {
      pParent = await this.openAnyObjectType(parseInt(params.parentId));
      this.objectCache.set(params.parentId, pParent);
    }

    const response = await this.sendAction(pParent, 'RMPOBJECT_OPEN', (payload: any) => {
      payload.pName.wsRMPObjectId = params.name;
      payload.pType.bType = 1;
      payload.pType.bSubtype = 0;
      payload.pType.bFiction = 0;
      payload.pType.bMovable = 0;
      payload.pOwner.twRPersonaIx = 1;
      payload.pResource.qwResource = 0;
      payload.pResource.sName = params.resourceName || '';
      payload.pResource.sReference = params.resource || '';
      payload.pTransform.vPosition.dX = params.position?.x ?? 0;
      payload.pTransform.vPosition.dY = params.position?.y ?? 0;
      payload.pTransform.vPosition.dZ = params.position?.z ?? 0;
      payload.pTransform.qRotation.dX = params.rotation?.x ?? 0;
      payload.pTransform.qRotation.dY = params.rotation?.y ?? 0;
      payload.pTransform.qRotation.dZ = params.rotation?.z ?? 0;
      payload.pTransform.qRotation.dW = params.rotation?.w ?? 1;
      payload.pTransform.vScale.dX = params.scale?.x ?? 1;
      payload.pTransform.vScale.dY = params.scale?.y ?? 1;
      payload.pTransform.vScale.dZ = params.scale?.z ?? 1;
      payload.pBound.dX = params.bound?.x ?? 1;
      payload.pBound.dY = params.bound?.y ?? 1;
      payload.pBound.dZ = params.bound?.z ?? 1;
    });

    if (response.nResult !== 0) {
      throw new Error(`Failed to create object: error ${response.nResult}`);
    }

    const newId = response.aResultSet?.[0]?.[0]?.twRMPObjectIx?.toString() || Date.now().toString();

    return {
      id: newId,
      parentId: params.parentId,
      name: params.name,
      transform: {
        position: params.position ?? { x: 0, y: 0, z: 0 },
        rotation: params.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
        scale: params.scale ?? { x: 1, y: 1, z: 1 },
      },
      resource: params.resource ?? null,
      resourceName: params.resourceName ?? null,
      bound: null,
      classId: ClassIds.RMPObject,
      children: [],
    };
  }

  async updateObject(params: UpdateObjectParams): Promise<RMPObject> {
    this.ensureConnected();

    let pObject = this.objectCache.get(params.objectId);
    if (!pObject) {
      pObject = await this.openAnyObjectType(parseInt(params.objectId));
      this.objectCache.set(params.objectId, pObject);
    }

    if (params.name !== undefined) {
      const response = await this.sendAction(pObject, 'NAME', (payload: any) => {
        payload.pName.wsRMPObjectId = params.name;
      });
      if (response.nResult !== 0) {
        throw new Error(`Failed to update name: error ${response.nResult}`);
      }
    }

    if (params.position !== undefined || params.rotation !== undefined || params.scale !== undefined) {
      const response = await this.sendAction(pObject, 'TRANSFORM', (payload: any) => {
        if (params.position) {
          payload.pTransform.vPosition.dX = params.position.x;
          payload.pTransform.vPosition.dY = params.position.y;
          payload.pTransform.vPosition.dZ = params.position.z;
        }
        if (params.rotation) {
          payload.pTransform.qRotation.dX = params.rotation.x;
          payload.pTransform.qRotation.dY = params.rotation.y;
          payload.pTransform.qRotation.dZ = params.rotation.z;
          payload.pTransform.qRotation.dW = params.rotation.w;
        }
        if (params.scale) {
          payload.pTransform.vScale.dX = params.scale.x;
          payload.pTransform.vScale.dY = params.scale.y;
          payload.pTransform.vScale.dZ = params.scale.z;
        }
      });
      if (response.nResult !== 0) {
        throw new Error(`Failed to update transform: error ${response.nResult}`);
      }
    }

    if (params.resource !== undefined) {
      // Parse resource format: "sReference:sName" or just "sReference"
      let sReference = params.resource;
      let sName = '';
      const colonIndex = params.resource.indexOf(':', params.resource.indexOf('://') + 3);
      if (colonIndex > 0) {
        sReference = params.resource.substring(0, colonIndex);
        sName = params.resource.substring(colonIndex + 1);
      }
      const response = await this.sendAction(pObject, 'RESOURCE', (payload: any) => {
        payload.pResource.sReference = sReference;
        payload.pResource.sName = sName;
      });
      if (response.nResult !== 0) {
        throw new Error(`Failed to update resource: error ${response.nResult}`);
      }
    }

    return this.getObject(params.objectId);
  }

  async deleteObject(objectId: string, allowUnknownType?: boolean): Promise<void> {
    this.ensureConnected();

    let pObject = this.objectCache.get(objectId);
    if (!pObject) {
      if (!allowUnknownType) {
        throw new Error(
          `Object ${objectId} not in cache. Either load it first with get_object, ` +
          `or set allowUnknownType: true to query the server (requires trying multiple object types).`
        );
      }
      pObject = await this.openAnyObjectType(parseInt(objectId));
      this.objectCache.set(objectId, pObject);
    }

    const parentId = pObject.twParentIx.toString();
    let pParent = this.objectCache.get(parentId);
    if (!pParent) {
      const parentClassId = pObject.wClass_Parent;
      if (parentClassId && MVFabricClient.CLASS_ID_TO_TYPE[parentClassId]) {
        pParent = await this.openWithKnownType(pObject.twParentIx, parentClassId);
      } else if (allowUnknownType) {
        pParent = await this.openAnyObjectType(pObject.twParentIx);
      } else {
        throw new Error(
          `Parent object ${parentId} not in cache and type unknown. ` +
          `Set allowUnknownType: true to query the server.`
        );
      }
      this.objectCache.set(parentId, pParent);
    }

    const response = await this.sendAction(pParent, 'RMPOBJECT_CLOSE', (payload: any) => {
      payload.twRMPObjectIx_Close = parseInt(objectId);
      payload.bDeleteAll = 0;
    });

    if (response.nResult !== 0) {
      throw new Error(`Failed to delete object: error ${response.nResult}`);
    }

    this.objectCache.delete(objectId);
  }

  async moveObject(objectId: string, newParentId: string): Promise<RMPObject> {
    this.ensureConnected();

    let pObject = this.objectCache.get(objectId);
    if (!pObject) {
      pObject = await this.openAnyObjectType(parseInt(objectId));
      this.objectCache.set(objectId, pObject);
    }

    const response = await this.sendAction(pObject, 'PARENT', (payload: any) => {
      payload.wClass = ClassIds.RMPObject;
      payload.twObjectIx = parseInt(newParentId);
    });

    if (response.nResult !== 0) {
      throw new Error(`Failed to move object: error ${response.nResult}`);
    }

    return this.getObject(objectId);
  }

  async bulkUpdate(operations: BulkOperation[]): Promise<{ success: number; failed: number; errors: string[] }> {
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

  private async loadFullTree(sceneId: string): Promise<RMPObject[]> {
    if (!this.objectCache.has(sceneId)) {
      await this.openAnyObjectType(parseInt(sceneId));
    }

    const objects: RMPObject[] = [];
    const seenIds = new Set<string>();

    const collectObjects = async (pObject: any): Promise<void> => {
      const id = pObject.twObjectIx.toString();
      if (seenIds.has(id)) return;
      seenIds.add(id);

      objects.push(this.rmxToRMPObject(pObject));

      const children: any[] = [];
      this.enumAllChildTypes(pObject, (child: any) => {
        children.push(child);
      });

      const unopened = children.filter(c =>
        !seenIds.has(c.twObjectIx.toString()) && !this.objectCache.has(c.twObjectIx.toString())
      );
      await Promise.all(unopened.map(child =>
        this.openObject(child.twObjectIx, child.wClass_Object).catch(() => {})
      ));

      await Promise.all(children.map(child => collectObjects(child)));
    };

    const pScene = this.objectCache.get(sceneId);
    if (pScene) {
      await collectObjects(pScene);
    }

    return objects;
  }

  async findObjects(sceneId: string, query: SearchQuery): Promise<RMPObject[]> {
    this.ensureConnected();

    // Use server-side SEARCH when we have a text query
    if (query.namePattern) {
      return this.serverSearch(sceneId, query);
    }

    // Fall back to client-side filtering for non-text queries
    const allObjects = await this.loadFullTree(sceneId);
    return allObjects.filter(obj => {
      if (query.resourceUrl && obj.resource !== query.resourceUrl) return false;
      if (query.positionRadius) {
        const { center, radius } = query.positionRadius;
        const pos = obj.transform.position;
        const dist = Math.sqrt(
          Math.pow(pos.x - center.x, 2) +
          Math.pow(pos.y - center.y, 2) +
          Math.pow(pos.z - center.z, 2)
        );
        if (dist > radius) return false;
      }
      return true;
    });
  }

  private async serverSearch(sceneId: string, query: SearchQuery): Promise<RMPObject[]> {
    let pScene = this.objectCache.get(sceneId);
    if (!pScene) {
      pScene = await this.openAndWait('RMPObject', parseInt(sceneId));
      this.objectCache.set(sceneId, pScene);
    }

    const pIAction = pScene.Request('SEARCH');
    if (!pIAction) {
      // SEARCH not available on this object type, fall back to full tree
      const allObjects = await this.loadFullTree(sceneId);
      const pattern = new RegExp(query.namePattern!, 'i');
      return allObjects.filter(obj => pattern.test(obj.name));
    }

    const payload = pIAction.pRequest;

    // Set the parent context based on object type
    if (pScene.sID === 'RMCObject') {
      payload.twRMCObjectIx = pScene.twObjectIx;
    } else {
      payload.twRMTObjectIx = pScene.twObjectIx;
    }

    payload.dX = query.positionRadius?.center.x ?? 0;
    payload.dY = query.positionRadius?.center.y ?? 0;
    payload.dZ = query.positionRadius?.center.z ?? 0;
    payload.sText = query.namePattern!.toLowerCase();

    const response = await this.sendAction(pScene, 'SEARCH', (p: any) => {
      Object.assign(p, payload);
    });

    if (response.nResult !== 0) {
      throw new Error(`Search failed: error ${response.nResult}`);
    }

    const results: RMPObject[] = [];
    const resultSet = response.aResultSet?.[0] || [];
    for (const item of resultSet) {
      const objectId = item.twRMPObjectIx?.toString() || item.twRMTObjectIx?.toString() || item.twRMCObjectIx?.toString();
      if (objectId) {
        try {
          const obj = await this.getObject(objectId);
          results.push(obj);
        } catch {
          // Skip objects we can't open
        }
      }
    }

    return results;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Not connected. Call fabric_connect first, or wait for auto-reconnect.');
    }
  }

  private sendAction(pObject: any, actionName: string, fillPayload: (payload: any) => void): Promise<any> {
    return new Promise((resolve, reject) => {
      const pIAction = pObject.Request(actionName);
      if (!pIAction) {
        reject(new Error(`Action ${actionName} not available`));
        return;
      }

      fillPayload(pIAction.pRequest);

      pIAction.Send(this, (pIAction: any) => {
        resolve(pIAction.pResponse);
      });
    });
  }

  private getChildIds(pObject: any): string[] {
    const childIds: string[] = [];
    this.enumAllChildTypes(pObject, (child: any) => {
      if (child?.twObjectIx) {
        childIds.push(child.twObjectIx.toString());
      }
    });
    return childIds;
  }

  private rmxToRMPObject(rmx: any): RMPObject {
    const id = rmx.twObjectIx.toString();
    const name = this.getObjectName(rmx);
    const nChildren = rmx.nChildren ?? 0;
    const childIds = this.getChildIds(rmx);
    // If nChildren > 0 but no children enumerated, they haven't been loaded yet
    const children = (nChildren > 0 && childIds.length === 0) ? null : childIds;
    return {
      id,
      parentId: rmx.twParentIx ? rmx.twParentIx.toString() : null,
      name,
      transform: {
        position: {
          x: rmx.pTransform?.vPosition?.dX ?? 0,
          y: rmx.pTransform?.vPosition?.dY ?? 0,
          z: rmx.pTransform?.vPosition?.dZ ?? 0,
        },
        rotation: {
          x: rmx.pTransform?.qRotation?.dX ?? 0,
          y: rmx.pTransform?.qRotation?.dY ?? 0,
          z: rmx.pTransform?.qRotation?.dZ ?? 0,
          w: rmx.pTransform?.qRotation?.dW ?? 1,
        },
        scale: {
          x: rmx.pTransform?.vScale?.dX ?? 1,
          y: rmx.pTransform?.vScale?.dY ?? 1,
          z: rmx.pTransform?.vScale?.dZ ?? 1,
        },
      },
      resource: rmx.pResource?.sReference
        ? (rmx.pResource.sName ? `${rmx.pResource.sReference}:${rmx.pResource.sName}` : rmx.pResource.sReference)
        : null,
      resourceName: rmx.pResource?.sName ?? null,
      bound: rmx.pBound ? {
        min: { x: -rmx.pBound.dX / 2, y: -rmx.pBound.dY / 2, z: -rmx.pBound.dZ / 2 },
        max: { x: rmx.pBound.dX / 2, y: rmx.pBound.dY / 2, z: rmx.pBound.dZ / 2 },
      } : null,
      classId: rmx.wClass_Object,
      children,
    };
  }

  getResourceRootUrl(): string {
    return this.pFabric?.pMSFConfig?.map?.sRootUrl || '';
  }

  resolveResourceName(resourceName: string | null): string | null {
    if (!resourceName) return null;

    if (resourceName.startsWith('http://') || resourceName.startsWith('https://')) {
      return resourceName;
    }

    const rootUrl = this.getResourceRootUrl();
    if (!rootUrl) return null;

    return new URL(resourceName, rootUrl).href;
  }
}
