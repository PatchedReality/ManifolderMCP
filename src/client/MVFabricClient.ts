// @ts-nocheck - MVMF libraries are untyped JavaScript
import '../vendor/mv/index.js';

// Debug logging (disabled in production)
function debugLog(_msg: string) {}

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
  private fabricUrl: string | null = null;
  private currentSceneId: string | null = null;
  private adminKey: string | null = null;
  private loginAttempted = false;

  private objectCache: Map<string, any> = new Map();
  private sceneClassIds: Map<string, number> = new Map();
  private pendingReady: Map<string, { resolve: () => void; reject: (err: Error) => void }> = new Map();
  private pendingUpdates: Map<string, { remaining: number; resolve: () => void; reject: (err: Error) => void }> = new Map();
  private attachedObjects: Set<any> = new Set();
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;
  private connectionGeneration = 0;

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
    try {
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
    } catch (err) {
      debugLog(`[onReadyState] ERROR: ${(err as Error).message}`);
    }
  }

  onInserted(pNotice: any) {
    try {
      const pChild = pNotice.pData?.pChild;
      const pParent = pNotice.pCreator;
      debugLog(`[onInserted] parent=${pParent?.twObjectIx} parentClass=${pParent?.wClass_Object} child=${pChild?.twObjectIx} childClass=${pChild?.wClass_Object} childName=${pChild?.pName?.wsRMPObjectId || pChild?.pName?.wsRMTObjectId || pChild?.pName?.wsRMCObjectId}`);
      if (pChild?.twObjectIx) {
        this.objectCache.set(pChild.twObjectIx.toString(), pChild);
      }
    } catch (err) {
      debugLog(`[onInserted] ERROR: ${(err as Error).message}`);
    }
  }

  onUpdated(pNotice: any) {
    try {
      const pChild = pNotice.pData?.pChild;
      if (pChild?.twObjectIx) {
        const id = pChild.twObjectIx.toString();
        this.objectCache.set(id, pChild);

        const pending = this.pendingUpdates.get(id);
        if (pending) {
          pending.remaining--;
          if (pending.remaining <= 0) {
            this.pendingUpdates.delete(id);
            pending.resolve();
          }
        }
      }
    } catch (err) {
      debugLog(`[onUpdated] ERROR: ${(err as Error).message}`);
    }
  }

  private waitForUpdates(objectId: string, count: number, timeoutMs: number = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingUpdates.delete(objectId);
        reject(new Error(`Timeout waiting for ${count} update(s) on object ${objectId}`));
      }, timeoutMs);

      this.pendingUpdates.set(objectId, {
        remaining: count,
        resolve: () => { clearTimeout(timeoutId); resolve(); },
        reject: (err: Error) => { clearTimeout(timeoutId); reject(err); },
      });
    });
  }

  private attachTo(pObject: any): void {
    if (pObject && !this.attachedObjects.has(pObject)) {
      pObject.Attach(this);
      this.attachedObjects.add(pObject);
    }
  }

  private detachFrom(pObject: any): void {
    if (pObject && this.attachedObjects.has(pObject)) {
      try {
        pObject.Detach(this);
      } catch {
        // Ignore errors during detach
      }
      this.attachedObjects.delete(pObject);
    }
  }

  private detachAll(): void {
    for (const pObject of this.attachedObjects) {
      try {
        pObject.Detach(this);
      } catch {
        // Ignore errors during detach
      }
    }
    this.attachedObjects.clear();
  }

  onChanged(pNotice: any) {
    try {
      this.onUpdated(pNotice);
    } catch (err) {
      debugLog(`[onChanged] ERROR: ${(err as Error).message}`);
    }
  }

  onDeleting(pNotice: any) {
    try {
      const pChild = pNotice.pData?.pChild;
      if (pChild?.twObjectIx) {
        const id = pChild.twObjectIx.toString();
        this.objectCache.delete(id);
      }
    } catch (err) {
      debugLog(`[onDeleting] ERROR: ${(err as Error).message}`);
    }
  }

  async connect(fabricUrl: string, adminKey: string, timeoutMs: number = 60000): Promise<void> {
    if (this.connected || this.pFabric) {
      await this.disconnect();
    }

    this.fabricUrl = fabricUrl;
    this.adminKey = adminKey;
    this.loginAttempted = false;
    ++this.connectionGeneration;
    const capturedGeneration = this.connectionGeneration;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.connectionGeneration === capturedGeneration) {
          this.connectResolve = null;
          this.connectReject = null;
          reject(new Error(`Connection timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.connectResolve = () => {
        if (this.connectionGeneration === capturedGeneration) {
          clearTimeout(timeoutId);
          resolve();
        }
      };
      this.connectReject = (err: Error) => {
        if (this.connectionGeneration === capturedGeneration) {
          clearTimeout(timeoutId);
          reject(err);
        }
      };

      this.pFabric = new MV.MVRP.MSF(fabricUrl, MV.MVRP.MSF.eMETHOD.GET);
      this.attachTo(this.pFabric);
    });
  }

  private handleReadyState(pNotice: any) {
    // Ignore callbacks from a previous connection
    if (pNotice.pCreator !== this.pFabric && pNotice.pCreator !== this.pLnG) {
      return;
    }

    if (pNotice.pCreator === this.pFabric) {
      if (this.pFabric.IsReady()) {
        this.pLnG = this.pFabric.GetLnG('map');
        if (!this.pLnG) {
          this.connectReject?.(new Error('Failed to get LnG "map" from fabric config'));
          this.connectResolve = null;
          this.connectReject = null;
          return;
        }
        this.attachTo(this.pLnG);
      } else if (this.pFabric.ReadyState() === this.pFabric.eSTATE.ERROR) {
        this.connectReject?.(new Error('Failed to load fabric config from ' + this.fabricUrl));
        this.connectResolve = null;
        this.connectReject = null;
      }
    } else if (pNotice.pCreator === this.pLnG) {
      const state = this.pLnG.ReadyState();
      if (state === this.pLnG.eSTATE.LOGGEDIN) {
        const wasConnected = this.connected;
        this.connected = true;
        this.loggedIn = true;
        if (!wasConnected) {
          this.start();
          this.connectResolve?.();
          this.connectResolve = null;
          this.connectReject = null;
        }
      } else if (state === this.pLnG.eSTATE.LOGGEDOUT) {
        if (this.adminKey) {
          if (this.loginAttempted) {
            this.connectReject?.(new Error('Login failed: invalid admin key or authentication error'));
            this.connectResolve = null;
            this.connectReject = null;
          } else {
            this.loginAttempted = true;
            this.pLnG.Login('token=' + MV.MVMF.Escape(this.adminKey));
          }
        } else {
          this.connected = true;
          this.loggedIn = false;
            this.start();
          this.connectResolve?.();
          this.connectResolve = null;
          this.connectReject = null;
        }
      } else if (state === this.pLnG.eSTATE.DISCONNECTED) {
        if (this.connected) {
          this.handleUnexpectedDisconnect();
        } else {
          this.connectReject?.(new Error('Disconnected from server'));
          this.connectResolve = null;
          this.connectReject = null;
        }
      } else if (state === this.pLnG.eSTATE.ERROR) {
        if (this.connected) {
          this.handleUnexpectedDisconnect();
        } else {
          this.connectReject?.(new Error('LnG connection error'));
          this.connectResolve = null;
          this.connectReject = null;
        }
      }
    }
  }

  private handleUnexpectedDisconnect(): void {
    this.connected = false;
    this.loggedIn = false;

    // Reject all pending object-ready promises
    for (const [, pending] of this.pendingReady) {
      pending.reject(new Error('Connection lost'));
    }
    this.pendingReady.clear();

    // Reject all pending update promises
    for (const [, pending] of this.pendingUpdates) {
      pending.reject(new Error('Connection lost'));
    }
    this.pendingUpdates.clear();
  }

  private start() {
    this.pRMRoot = this.pLnG.Model_Open('RMRoot', 1);
    this.attachTo(this.pRMRoot);
  }

  private async openAndWait(modelType: string, objectId: number, timeoutMs?: number): Promise<any> {
    const pObject = this.pLnG.Model_Open(modelType, objectId);
    if (!pObject) {
      throw new Error(`Failed to open ${modelType} with id ${objectId}`);
    }
    this.attachTo(pObject);
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
    // Bump generation so any in-flight callbacks from this connection are ignored
    this.connectionGeneration++;

    // Reject any pending connect promise
    if (this.connectReject) {
      this.connectReject(new Error('Disconnected'));
    }
    this.connectResolve = null;
    this.connectReject = null;

    // Reject all pending object-ready promises
    for (const [key, pending] of this.pendingReady) {
      pending.reject(new Error('Disconnected'));
    }
    this.pendingReady.clear();

    // Reject all pending update promises
    for (const [key, pending] of this.pendingUpdates) {
      pending.reject(new Error('Disconnected'));
    }
    this.pendingUpdates.clear();

    // Detach from all MVMF objects before destroying
    this.detachAll();

    if (this.pRMRoot) {
      try {
        this.pLnG.Model_Close(this.pRMRoot);
      } catch {
        // Ignore errors during teardown
      }
      this.pRMRoot = null;
    }
    if (this.pFabric) {
      try {
        await this.pFabric.destructor();
      } catch {
        // Ignore errors during teardown
      }
      this.pFabric = null;
    }
    this.pLnG = null;
    this.connected = false;
    this.loggedIn = false;
    this.fabricUrl = null;
    this.adminKey = null;
    this.currentSceneId = null;
    this.objectCache.clear();
    this.sceneClassIds.clear();
  }

  getStatus(): ConnectionStatus {
    return {
      connected: this.connected,
      fabricUrl: this.fabricUrl,
      currentSceneId: this.currentSceneId,
      currentSceneName: null,
      resourceRootUrl: this.getResourceRootUrl() || null,
    };
  }

  async listScenes(): Promise<Scene[]> {
    await this.ensureConnected();
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
      scenes.push({ id, name, rootObjectId: id, classId });
    };

    this.enumAllChildTypes(this.pRMRoot, enumCallback);
    return scenes;
  }

  async openScene(sceneId: string): Promise<RMPObject> {
    await this.ensureConnected();

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

    // Eagerly load direct children so list_objects works immediately
    await this.loadDirectChildren(pObject);

    return this.rmxToRMPObject(pObject);
  }

  private async loadDirectChildren(pObject: any): Promise<void> {
    let children: any[] = [];
    this.enumAllChildTypes(pObject, (child: any) => {
      children.push(child);
    });

    // Children may not be enumerable yet if notifications haven't arrived.
    // Send UPDATE to force-fetch and give async child notifications time to arrive.
    if (children.length === 0) {
      debugLog(`[loadDirectChildren] no children enumerable yet, sending UPDATE to trigger child loading`);
      try {
        await this.sendAction(pObject, 'UPDATE', () => {});
      } catch (err) {
        debugLog(`[loadDirectChildren] UPDATE failed: ${(err as Error).message}`);
      }
      // Re-enumerate after UPDATE round-trip
      children = [];
      this.enumAllChildTypes(pObject, (child: any) => {
        children.push(child);
      });
    }

    if (children.length > 0) {
      debugLog(`[loadDirectChildren] opening ${children.length} children`);
      await Promise.all(children.map(async (child) => {
        const childId = child.twObjectIx?.toString();
        if (!childId || this.objectCache.has(childId)) return;
        try {
          const classId = child.wClass_Object;
          let pChild: any;
          if (classId && MVFabricClient.CLASS_ID_TO_TYPE[classId]) {
            pChild = await this.openAndWait(MVFabricClient.CLASS_ID_TO_TYPE[classId], child.twObjectIx, 10000);
          } else {
            pChild = await this.openAnyObjectType(child.twObjectIx);
          }
          this.objectCache.set(childId, pChild);
        } catch (err) {
          debugLog(`[loadDirectChildren] failed to open child ${childId}: ${(err as Error).message}`);
        }
      }));
    }
  }

  async createScene(name: string): Promise<Scene> {
    await this.ensureConnected();
    await this.waitForReady(this.pRMRoot);

    const response = await this.sendAction(this.pRMRoot, 'RMTOBJECT_OPEN', (payload: any) => {
      payload.pName.wsRMTObjectId = name;
      payload.pType.bType = 1; // Root
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
      console.error(`[createScene] RMTOBJECT_OPEN response:`, JSON.stringify(response));
      throw new Error(`Failed to create scene: error ${response.nResult}`);
    }

    const newId = response.aResultSet?.[0]?.[0]?.twRMTObjectIx?.toString() || Date.now().toString();
    return { id: newId, name, rootObjectId: newId, classId: ClassIds.RMTObject };
  }

  async deleteScene(sceneId: string): Promise<void> {
    await this.ensureConnected();
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
    await this.ensureConnected();

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
    await this.ensureConnected();

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
    await this.ensureConnected();

    let pParent = this.objectCache.get(params.parentId);
    if (!pParent) {
      pParent = await this.openAnyObjectType(parseInt(params.parentId));
      this.objectCache.set(params.parentId, pParent);
    }

    const isTerrestrial = params.objectType === 'parcel' || params.objectType === 'terrestrial-root';
    const actionName = isTerrestrial ? 'RMTOBJECT_OPEN' : 'RMPOBJECT_OPEN';
    const nameField = isTerrestrial ? 'wsRMTObjectId' : 'wsRMPObjectId';
    const classId = isTerrestrial ? ClassIds.RMTObject : ClassIds.RMPObject;

    let bType: number;
    switch (params.objectType) {
      case 'terrestrial-root': bType = 1; break;
      case 'parcel': bType = 11; break;
      default: bType = 0;
    }

    const response = await this.sendAction(pParent, actionName, (payload: any) => {
      payload.pName[nameField] = params.name;
      payload.pType.bType = bType;
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

    const resultIdField = isTerrestrial ? 'twRMTObjectIx' : 'twRMPObjectIx';
    const newId = response.aResultSet?.[0]?.[0]?.[resultIdField]?.toString() || Date.now().toString();

    // Re-fetch parent so its nChildren and child list reflect the new child
    if (!params.skipParentRefetch) {
      this.objectCache.delete(params.parentId);
      await this.openAnyObjectType(parseInt(params.parentId));
    }

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
      classId,
      children: null,
    };
  }

  async updateObject(params: UpdateObjectParams): Promise<RMPObject> {
    await this.ensureConnected();

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
        // Always fill the full transform from current state, then override with provided values
        payload.pTransform.vPosition.dX = params.position?.x ?? pObject.pTransform?.vPosition?.dX ?? 0;
        payload.pTransform.vPosition.dY = params.position?.y ?? pObject.pTransform?.vPosition?.dY ?? 0;
        payload.pTransform.vPosition.dZ = params.position?.z ?? pObject.pTransform?.vPosition?.dZ ?? 0;
        payload.pTransform.qRotation.dX = params.rotation?.x ?? pObject.pTransform?.qRotation?.dX ?? 0;
        payload.pTransform.qRotation.dY = params.rotation?.y ?? pObject.pTransform?.qRotation?.dY ?? 0;
        payload.pTransform.qRotation.dZ = params.rotation?.z ?? pObject.pTransform?.qRotation?.dZ ?? 0;
        payload.pTransform.qRotation.dW = params.rotation?.w ?? pObject.pTransform?.qRotation?.dW ?? 1;
        payload.pTransform.vScale.dX = params.scale?.x ?? pObject.pTransform?.vScale?.dX ?? 1;
        payload.pTransform.vScale.dY = params.scale?.y ?? pObject.pTransform?.vScale?.dY ?? 1;
        payload.pTransform.vScale.dZ = params.scale?.z ?? pObject.pTransform?.vScale?.dZ ?? 1;
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

    // Invalidate cache so the next read re-fetches confirmed server state
    this.objectCache.delete(params.objectId);
    if (params.skipRefetch) {
      return {
        id: params.objectId,
        parentId: pObject.twParentIx?.toString() ?? null,
        name: params.name ?? this.getObjectName(pObject),
        transform: {
          position: params.position ?? { x: pObject.pTransform?.vPosition?.dX ?? 0, y: pObject.pTransform?.vPosition?.dY ?? 0, z: pObject.pTransform?.vPosition?.dZ ?? 0 },
          rotation: params.rotation ?? { x: pObject.pTransform?.qRotation?.dX ?? 0, y: pObject.pTransform?.qRotation?.dY ?? 0, z: pObject.pTransform?.qRotation?.dZ ?? 0, w: pObject.pTransform?.qRotation?.dW ?? 1 },
          scale: params.scale ?? { x: pObject.pTransform?.vScale?.dX ?? 1, y: pObject.pTransform?.vScale?.dY ?? 1, z: pObject.pTransform?.vScale?.dZ ?? 1 },
        },
        resource: params.resource ?? pObject.pResource?.sReference ?? null,
        resourceName: pObject.pResource?.sName ?? null,
        bound: null,
        classId: pObject.wClass_Object,
        children: null,
      };
    }
    return this.getObject(params.objectId);
  }

  async deleteObject(objectId: string, allowUnknownType?: boolean): Promise<void> {
    await this.ensureConnected();

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

  async moveObject(objectId: string, newParentId: string, skipRefetch?: boolean): Promise<RMPObject> {
    await this.ensureConnected();

    let pObject = this.objectCache.get(objectId);
    if (!pObject) {
      pObject = await this.openAnyObjectType(parseInt(objectId));
      this.objectCache.set(objectId, pObject);
    }

    let pNewParent = this.objectCache.get(newParentId);
    if (!pNewParent) {
      pNewParent = await this.openAnyObjectType(parseInt(newParentId));
      this.objectCache.set(newParentId, pNewParent);
    }

    const oldParentId = pObject.twParentIx?.toString();

    const response = await this.sendAction(pObject, 'PARENT', (payload: any) => {
      payload.wClass = pNewParent.wClass_Object;
      payload.twObjectIx = parseInt(newParentId);
    });

    if (response.nResult !== 0) {
      throw new Error(`Failed to move object: error ${response.nResult}`);
    }

    if (skipRefetch) {
      // Invalidate moved object and old parent; keep new parent cached for sibling moves
      this.objectCache.delete(objectId);
      if (oldParentId) this.objectCache.delete(oldParentId);
      return {
        id: objectId,
        parentId: newParentId,
        name: this.getObjectName(pObject),
        transform: {
          position: { x: pObject.pTransform?.vPosition?.dX ?? 0, y: pObject.pTransform?.vPosition?.dY ?? 0, z: pObject.pTransform?.vPosition?.dZ ?? 0 },
          rotation: { x: pObject.pTransform?.qRotation?.dX ?? 0, y: pObject.pTransform?.qRotation?.dY ?? 0, z: pObject.pTransform?.qRotation?.dZ ?? 0, w: pObject.pTransform?.qRotation?.dW ?? 1 },
          scale: { x: pObject.pTransform?.vScale?.dX ?? 1, y: pObject.pTransform?.vScale?.dY ?? 1, z: pObject.pTransform?.vScale?.dZ ?? 1 },
        },
        resource: pObject.pResource?.sReference ?? null,
        resourceName: pObject.pResource?.sName ?? null,
        bound: null,
        classId: pObject.wClass_Object,
        children: null,
      };
    }

    // Wait for server update notifications (2 events: old parent + new parent)
    await this.waitForUpdates(objectId, 2);

    // Invalidate so next reads use the server-updated cache entries
    this.objectCache.delete(objectId);
    if (oldParentId) this.objectCache.delete(oldParentId);
    this.objectCache.delete(newParentId);
    return this.getObject(objectId);
  }

  async bulkUpdate(operations: BulkOperation[]): Promise<{ success: number; failed: number; createdIds: string[]; errors: string[] }> {
    let success = 0;
    let failed = 0;
    const createdIds: string[] = [];
    const errors: string[] = [];

    const CONCURRENCY = 10;
    const staleParentIds = new Set<string>();

    // Pre-fetch all referenced objects so concurrent ops don't race on openAnyObjectType
    const idsToPreload = new Set<string>();
    for (const op of operations) {
      switch (op.type) {
        case 'create':
          idsToPreload.add((op.params as CreateObjectParams).parentId);
          break;
        case 'update':
          idsToPreload.add((op.params as UpdateObjectParams).objectId);
          break;
        case 'delete':
          idsToPreload.add((op.params as { objectId: string }).objectId);
          break;
        case 'move': {
          const p = op.params as { objectId: string; newParentId: string };
          idsToPreload.add(p.objectId);
          idsToPreload.add(p.newParentId);
          break;
        }
      }
    }
    // Remove IDs already cached
    for (const id of idsToPreload) {
      if (this.objectCache.has(id)) idsToPreload.delete(id);
    }
    if (idsToPreload.size > 0) {
      debugLog(`[bulkUpdate] pre-fetching ${idsToPreload.size} objects`);
      for (const id of idsToPreload) {
        try {
          const pObj = await this.openAnyObjectType(parseInt(id));
          this.objectCache.set(id, pObj);
        } catch (err) {
          debugLog(`[bulkUpdate] pre-fetch failed for ${id}: ${(err as Error).message}`);
        }
      }
    }

    const successfulMoveIds = new Set<string>();

    const executeOp = async (op: BulkOperation): Promise<string | null> => {
      switch (op.type) {
        case 'create': {
          const createParams = op.params as CreateObjectParams;
          const obj = await this.createObject({ ...createParams, skipParentRefetch: true });
          staleParentIds.add(createParams.parentId);
          return obj.id;
        }
        case 'update':
          await this.updateObject({ ...op.params as UpdateObjectParams, skipRefetch: true });
          return null;
        case 'delete':
          await this.deleteObject((op.params as { objectId: string }).objectId);
          return null;
        case 'move': {
          const moveParams = op.params as { objectId: string; newParentId: string };
          const pObj = this.objectCache.get(moveParams.objectId);
          const oldParentId = pObj?.twParentIx?.toString();
          await this.moveObject(moveParams.objectId, moveParams.newParentId, true);
          successfulMoveIds.add(moveParams.objectId);
          if (oldParentId) staleParentIds.add(oldParentId);
          staleParentIds.add(moveParams.newParentId);
          return null;
        }
      }
    };

    // Register update listeners for moves BEFORE executing, so we don't miss notifications
    const moveUpdatePromises = new Map<string, Promise<void>>();
    for (const op of operations) {
      if (op.type === 'move') {
        const id = (op.params as { objectId: string }).objectId;
        moveUpdatePromises.set(id, this.waitForUpdates(id, 2, 10000));
      }
    }

    // Process all ops concurrently in batches
    for (let i = 0; i < operations.length; i += CONCURRENCY) {
      const batch = operations.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(op => executeOp(op)));

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled') {
          success++;
          if (result.value) createdIds.push(result.value);
        } else {
          failed++;
          errors.push(`${batch[j].type} failed: ${result.reason?.message || 'unknown error'}`);
          // Cancel pending update listener for failed moves
          const op = batch[j];
          if (op.type === 'move') {
            const id = (op.params as { objectId: string }).objectId;
            this.pendingUpdates.delete(id);
          }
        }
      }
    }

    // Wait only for successful move update notifications before re-fetching parents
    const successfulMovePromises = Array.from(successfulMoveIds)
      .map(id => moveUpdatePromises.get(id))
      .filter((p): p is Promise<void> => p !== undefined);
    if (successfulMovePromises.length > 0) {
      await Promise.allSettled(successfulMovePromises);
    }

    // Re-fetch stale parents so cache reflects new children
    if (staleParentIds.size > 0) {
      for (const parentId of staleParentIds) {
        try {
          this.objectCache.delete(parentId);
          const pParent = await this.openAnyObjectType(parseInt(parentId));
          this.objectCache.set(parentId, pParent);
        } catch {
          // Parent refresh is best-effort
        }
      }
    }

    return { success, failed, createdIds, errors };
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
    await this.ensureConnected();

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

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (this.fabricUrl && this.adminKey != null) {
      await this.connect(this.fabricUrl, this.adminKey);
      return;
    }
    throw new Error('Not connected. Call fabric_connect first.');
  }

  private sendAction(pObject: any, actionName: string, fillPayload: (payload: any) => void, timeoutMs: number = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const pIAction = pObject.Request(actionName);
      if (!pIAction) {
        reject(new Error(`Action ${actionName} not available`));
        return;
      }

      fillPayload(pIAction.pRequest);

      let completed = false;
      const timeoutId = setTimeout(() => {
        if (!completed) {
          completed = true;
          reject(new Error(`Timeout waiting for ${actionName} action response`));
        }
      }, timeoutMs);

      pIAction.Send(this, (pIAction: any) => {
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          resolve(pIAction.pResponse);
        }
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
