// @ts-nocheck - MVMF libraries are untyped JavaScript
import '../vendor/mv/index.js';

// Debug logging (disabled in production)
function debugLog(_msg: string) {}

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
import { ClassIds, ObjectTypeMap, formatObjectRef, parseObjectRef } from '../types.js';

declare const MV: any;

// Class-aware action lookups
const CLASS_ID_TO_OPEN_ACTION: Record<number, { action: string; nameField: string; resultField: string }> = {
  [ClassIds.RMCObject]: { action: 'RMCOBJECT_OPEN', nameField: 'wsRMCObjectId', resultField: 'twRMCObjectIx' },
  [ClassIds.RMTObject]: { action: 'RMTOBJECT_OPEN', nameField: 'wsRMTObjectId', resultField: 'twRMTObjectIx' },
  [ClassIds.RMPObject]: { action: 'RMPOBJECT_OPEN', nameField: 'wsRMPObjectId', resultField: 'twRMPObjectIx' },
};

const CLASS_ID_TO_CLOSE_ACTION: Record<number, { action: string; idField: string }> = {
  [ClassIds.RMCObject]: { action: 'RMCOBJECT_CLOSE', idField: 'twRMCObjectIx_Close' },
  [ClassIds.RMTObject]: { action: 'RMTOBJECT_CLOSE', idField: 'twRMTObjectIx_Close' },
  [ClassIds.RMPObject]: { action: 'RMPOBJECT_CLOSE', idField: 'twRMPObjectIx_Close' },
};

const CLASS_ID_TO_NAME_FIELD: Record<number, string> = {
  [ClassIds.RMCObject]: 'wsRMCObjectId',
  [ClassIds.RMTObject]: 'wsRMTObjectId',
  [ClassIds.RMPObject]: 'wsRMPObjectId',
};

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

  // Cache keyed by prefixed ID (e.g., "physical:42", "terrestrial:3")
  private objectCache: Map<string, any> = new Map();
  private pendingReady: Map<string, { resolve: () => void; reject: (err: Error) => void }> = new Map();
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

  private getPrefixedId(pObject: any): string {
    return formatObjectRef(pObject.wClass_Object, pObject.twObjectIx);
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
      if (pChild?.twObjectIx && pChild?.wClass_Object) {
        const prefixedId = this.getPrefixedId(pChild);
        this.objectCache.set(prefixedId, pChild);
      }
    } catch (err) {
      debugLog(`[onInserted] ERROR: ${(err as Error).message}`);
    }
  }

  onUpdated(pNotice: any) {
    try {
      const pChild = pNotice.pData?.pChild;
      if (pChild?.twObjectIx && pChild?.wClass_Object) {
        const prefixedId = this.getPrefixedId(pChild);
        this.objectCache.set(prefixedId, pChild);
      }
    } catch (err) {
      debugLog(`[onUpdated] ERROR: ${(err as Error).message}`);
    }
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
      if (pChild?.twObjectIx && pChild?.wClass_Object) {
        const prefixedId = this.getPrefixedId(pChild);
        this.objectCache.delete(prefixedId);
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

  private static readonly CLASS_ID_TO_TYPE: Record<number, string> = {
    [ClassIds.RMPObject]: 'RMPObject',
    [ClassIds.RMTObject]: 'RMTObject',
    [ClassIds.RMCObject]: 'RMCObject',
  };

  private static readonly CHILD_CLASS_TYPES = ['RMPObject', 'RMTObject', 'RMCObject'];

  private async openWithKnownType(objectId: number, classId: number): Promise<any> {
    const modelType = MVFabricClient.CLASS_ID_TO_TYPE[classId];
    if (!modelType) {
      throw new Error(`Unknown class ID: ${classId}`);
    }
    return await this.openAndWait(modelType, objectId);
  }

  private enumAllChildTypes(pObject: any, callback: (child: any) => void): void {
    for (const childType of MVFabricClient.CHILD_CLASS_TYPES) {
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
      const prefixedId = this.getPrefixedId(pRMXObject);
      if (seenIds.has(prefixedId)) return;
      seenIds.add(prefixedId);

      const name = this.getObjectName(pRMXObject);
      const classId = pRMXObject.wClass_Object;
      scenes.push({ id: prefixedId, name, rootObjectId: prefixedId, classId });
    };

    this.enumAllChildTypes(this.pRMRoot, enumCallback);
    return scenes;
  }

  async openScene(sceneId: string): Promise<FabricObject> {
    await this.ensureConnected();

    const { classId, numericId } = parseObjectRef(sceneId);
    const pObject = await this.openWithKnownType(numericId, classId);

    this.currentSceneId = sceneId;
    this.objectCache.set(sceneId, pObject);

    // Eagerly load direct children so list_objects works immediately
    await this.loadDirectChildren(pObject);

    return this.rmxToFabricObject(pObject);
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
        const childPrefixedId = this.getPrefixedId(child);
        if (this.objectCache.has(childPrefixedId)) return;
        try {
          const childClassId = child.wClass_Object;
          const pChild = await this.openWithKnownType(child.twObjectIx, childClassId);
          this.objectCache.set(childPrefixedId, pChild);
        } catch (err) {
          debugLog(`[loadDirectChildren] failed to open child ${childPrefixedId}: ${(err as Error).message}`);
        }
      }));
    }
  }

  async createScene(name: string, objectType?: string): Promise<Scene> {
    const obj = await this.createObject({
      parentId: 'root',
      name,
      objectType,
      bound: { x: 150, y: 150, z: 150 },
    });
    return { id: obj.id, name, rootObjectId: obj.id, classId: obj.classId };
  }

  async deleteScene(sceneId: string): Promise<void> {
    await this.ensureConnected();
    await this.waitForReady(this.pRMRoot);

    const { classId, numericId } = parseObjectRef(sceneId);
    const closeInfo = CLASS_ID_TO_CLOSE_ACTION[classId];
    if (!closeInfo) {
      throw new Error(`Cannot delete object of class ${classId}`);
    }

    const response = await this.sendAction(this.pRMRoot, closeInfo.action, (payload: any) => {
      payload[closeInfo.idField] = numericId;
      payload.bDeleteAll = 1;
    });

    if (response.nResult !== 0) {
      throw new Error(this.formatResponseError('Failed to delete scene', response));
    }

    if (this.currentSceneId === sceneId) {
      this.currentSceneId = null;
    }
    this.objectCache.delete(sceneId);
  }

  async listObjects(scopeId: string, filter?: ObjectFilter): Promise<FabricObject[]> {
    await this.ensureConnected();

    if (!this.objectCache.has(scopeId)) {
      const { classId, numericId } = parseObjectRef(scopeId);
      const pScene = await this.openWithKnownType(numericId, classId);
      this.objectCache.set(scopeId, pScene);
    }

    const objects: FabricObject[] = [];
    const seenIds = new Set<string>();

    const collectLoaded = (pObject: any): void => {
      const prefixedId = this.getPrefixedId(pObject);
      if (seenIds.has(prefixedId)) return;
      seenIds.add(prefixedId);

      objects.push(this.rmxToFabricObject(pObject));

      this.enumAllChildTypes(pObject, (child: any) => {
        collectLoaded(child);
      });
    };

    const pScene = this.objectCache.get(scopeId);
    if (pScene) {
      collectLoaded(pScene);
    }

    let result = objects;
    if (filter?.type) {
      const typeInfo = ObjectTypeMap[filter.type];
      if (typeInfo) {
        result = result.filter(obj => obj.classId === typeInfo.classId && obj.subtype === typeInfo.subtype);
      } else {
        result = result.filter(obj => obj.id.startsWith(filter.type! + ':'));
      }
    }
    if (filter?.namePattern) {
      const pattern = new RegExp(filter.namePattern, 'i');
      result = result.filter(obj => pattern.test(obj.name));
    }
    return result;
  }

  async getObject(objectId: string): Promise<FabricObject> {
    await this.ensureConnected();

    const { classId, numericId } = parseObjectRef(objectId);

    let pObject = this.objectCache.get(objectId);
    if (pObject) {
      if (!pObject.IsReady?.()) {
        debugLog(`[getObject] cached object ${objectId} not ready (class ${classId}), opening to load children`);
        pObject = await this.openWithKnownType(numericId, classId);
        this.objectCache.set(objectId, pObject);
      }
    } else {
      pObject = await this.openWithKnownType(numericId, classId);
      this.objectCache.set(objectId, pObject);
    }

    return this.rmxToFabricObject(pObject);
  }

  async createObject(params: CreateObjectParams): Promise<FabricObject> {
    await this.ensureConnected();

    // Determine child class from objectType
    let childClassId: number;
    let bType: number;
    if (params.objectType) {
      const typeInfo = ObjectTypeMap[params.objectType];
      if (!typeInfo) {
        throw new Error(`Unknown objectType "${params.objectType}". Valid types: ${Object.keys(ObjectTypeMap).join(', ')}`);
      }
      childClassId = typeInfo.classId;
      bType = typeInfo.subtype;
    } else {
      childClassId = ClassIds.RMPObject;
      bType = 0;
    }

    const openInfo = CLASS_ID_TO_OPEN_ACTION[childClassId];
    if (!openInfo) {
      throw new Error(`Cannot create objects of class ${childClassId}`);
    }

    const isRootParent = params.parentId === 'root';
    let pParent: any;
    if (isRootParent) {
      await this.waitForReady(this.pRMRoot);
      pParent = this.pRMRoot;
    } else {
      const { classId: parentClassId, numericId: parentNumericId } = parseObjectRef(params.parentId);
      pParent = this.objectCache.get(params.parentId);
      if (!pParent) {
        pParent = await this.openWithKnownType(parentNumericId, parentClassId);
        this.objectCache.set(params.parentId, pParent);
      }
    }

    const isCelestial = childClassId === ClassIds.RMCObject;
    const isTerrestrial = childClassId === ClassIds.RMTObject;

    const response = await this.sendAction(pParent, openInfo.action, (payload: any) => {
      payload.pName[openInfo.nameField] = params.name;
      payload.pType.bType = bType;
      payload.pType.bSubtype = 0;
      payload.pType.bFiction = 0;
      if (childClassId === ClassIds.RMPObject) {
        payload.pType.bMovable = 0;
      }
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
      if (isTerrestrial) {
        payload.pProperties.bLockToGround = 0;
        payload.pProperties.bYouth = 0;
        payload.pProperties.bAdult = 0;
        payload.pProperties.bAvatar = 0;
        payload.pCoord.bCoord = 3;
        payload.pCoord.dA = 0;
        payload.pCoord.dB = 0;
        payload.pCoord.dC = 0;
      }
      if (isCelestial) {
        payload.pOrbit_Spin.tmPeriod = 0;
        payload.pOrbit_Spin.tmStart = 0;
        payload.pOrbit_Spin.dA = 0;
        payload.pOrbit_Spin.dB = 0;
        payload.pProperties.fMass = 0;
        payload.pProperties.fGravity = 0;
        payload.pProperties.fColor = 0;
        payload.pProperties.fBrightness = 0;
        payload.pProperties.fReflectivity = 0;
      }
    });

    if (response.nResult !== 0) {
      throw new Error(this.formatResponseError('Failed to create object', response));
    }

    const numericNewId = response.aResultSet?.[0]?.[0]?.[openInfo.resultField];
    const newId = numericNewId != null
      ? formatObjectRef(childClassId, numericNewId)
      : `${formatObjectRef(childClassId, Date.now())}`;

    // Re-fetch parent so its nChildren and child list reflect the new child
    if (!params.skipParentRefetch && !isRootParent) {
      this.objectCache.delete(params.parentId);
      const { classId: parentClassId, numericId: parentNumericId } = parseObjectRef(params.parentId);
      const pRefreshedParent = await this.openWithKnownType(parentNumericId, parentClassId);
      this.objectCache.set(params.parentId, pRefreshedParent);
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
      classId: childClassId,
      subtype: bType,
      children: null,
    };
  }

  async updateObject(params: UpdateObjectParams): Promise<FabricObject> {
    await this.ensureConnected();

    const { classId, numericId } = parseObjectRef(params.objectId);

    let pObject = this.objectCache.get(params.objectId);
    if (!pObject) {
      pObject = await this.openWithKnownType(numericId, classId);
      this.objectCache.set(params.objectId, pObject);
    }

    if (params.name !== undefined) {
      const nameField = CLASS_ID_TO_NAME_FIELD[classId];
      if (!nameField) {
        throw new Error(`Cannot rename object of class ${classId}`);
      }
      const response = await this.sendAction(pObject, 'NAME', (payload: any) => {
        payload.pName[nameField] = params.name;
      });
      if (response.nResult !== 0) {
        throw new Error(this.formatResponseError('Failed to update name', response));
      }
    }

    if (params.position !== undefined || params.rotation !== undefined || params.scale !== undefined) {
      const response = await this.sendAction(pObject, 'TRANSFORM', (payload: any) => {
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
        throw new Error(this.formatResponseError('Failed to update transform', response));
      }

    }

    if (params.resource !== undefined || params.resourceName !== undefined) {
      let sReference = params.resource ?? pObject.pResource?.sReference ?? '';
      let sName = params.resourceName ?? '';
      if (params.resource !== undefined && params.resourceName === undefined) {
        // Parse colon-separated resource:name format as fallback
        const colonIndex = params.resource.indexOf(':', params.resource.indexOf('://') + 3);
        if (colonIndex > 0) {
          sReference = params.resource.substring(0, colonIndex);
          sName = params.resource.substring(colonIndex + 1);
        }
      }
      const response = await this.sendAction(pObject, 'RESOURCE', (payload: any) => {
        payload.pResource.sReference = sReference;
        payload.pResource.sName = sName;
      });
      if (response.nResult !== 0) {
        throw new Error(this.formatResponseError('Failed to update resource', response));
      }
    }

    if (params.bound !== undefined) {
      const response = await this.sendAction(pObject, 'BOUND', (payload: any) => {
        payload.pBound.dX = params.bound!.x;
        payload.pBound.dY = params.bound!.y;
        payload.pBound.dZ = params.bound!.z;
      });
      if (response.nResult !== 0) {
        throw new Error(this.formatResponseError('Failed to update bound', response));
      }
    }

    // Invalidate cache so the next read re-fetches confirmed server state
    this.objectCache.delete(params.objectId);
    if (params.skipRefetch) {
      const parentPrefixedId = pObject.twParentIx && pObject.wClass_Parent
        ? formatObjectRef(pObject.wClass_Parent, pObject.twParentIx)
        : null;
      return {
        id: params.objectId,
        parentId: parentPrefixedId,
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
        subtype: pObject.pType?.bType ?? 0,
        children: null,
      };
    }
    return this.getObject(params.objectId);
  }

  async deleteObject(objectId: string): Promise<void> {
    await this.ensureConnected();

    const { classId, numericId } = parseObjectRef(objectId);
    const closeInfo = CLASS_ID_TO_CLOSE_ACTION[classId];
    if (!closeInfo) {
      throw new Error(`Cannot delete object of class ${classId}`);
    }

    let pObject = this.objectCache.get(objectId);
    if (!pObject) {
      pObject = await this.openWithKnownType(numericId, classId);
      this.objectCache.set(objectId, pObject);
    }

    const parentClassId = pObject.wClass_Parent;
    const parentNumericId = pObject.twParentIx;
    const parentPrefixedId = parentClassId && parentNumericId
      ? formatObjectRef(parentClassId, parentNumericId)
      : null;

    let pParent = parentPrefixedId ? this.objectCache.get(parentPrefixedId) : null;
    if (!pParent && parentPrefixedId) {
      pParent = await this.openWithKnownType(parentNumericId, parentClassId);
      this.objectCache.set(parentPrefixedId, pParent);
    }
    if (!pParent) {
      throw new Error(`Cannot find parent for object ${objectId}`);
    }

    const response = await this.sendAction(pParent, closeInfo.action, (payload: any) => {
      payload[closeInfo.idField] = numericId;
      payload.bDeleteAll = 0;
    });

    if (response.nResult !== 0) {
      throw new Error(this.formatResponseError('Failed to delete object', response));
    }

    this.objectCache.delete(objectId);
  }

  async moveObject(objectId: string, newParentId: string, skipRefetch?: boolean): Promise<FabricObject> {
    await this.ensureConnected();

    const { classId, numericId } = parseObjectRef(objectId);
    const { classId: newParentClassId, numericId: newParentNumericId } = parseObjectRef(newParentId);

    let pObject = this.objectCache.get(objectId);
    if (!pObject) {
      pObject = await this.openWithKnownType(numericId, classId);
      this.objectCache.set(objectId, pObject);
    }

    let pNewParent = this.objectCache.get(newParentId);
    if (!pNewParent) {
      pNewParent = await this.openWithKnownType(newParentNumericId, newParentClassId);
      this.objectCache.set(newParentId, pNewParent);
    }

    const oldParentClassId = pObject.wClass_Parent;
    const oldParentNumericId = pObject.twParentIx;
    const oldParentId = oldParentClassId && oldParentNumericId
      ? formatObjectRef(oldParentClassId, oldParentNumericId)
      : null;

    const response = await this.sendAction(pObject, 'PARENT', (payload: any) => {
      payload.wClass = newParentClassId;
      payload.twObjectIx = newParentNumericId;
    });

    if (response.nResult !== 0) {
      throw new Error(this.formatResponseError('Failed to move object', response));
    }

    if (skipRefetch) {
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
        subtype: pObject.pType?.bType ?? 0,
        children: null,
      };
    }

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

    // Pre-fetch all referenced objects so concurrent ops don't race
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
    // Remove "root" and IDs already cached
    for (const id of idsToPreload) {
      if (id === 'root' || this.objectCache.has(id)) idsToPreload.delete(id);
    }
    if (idsToPreload.size > 0) {
      debugLog(`[bulkUpdate] pre-fetching ${idsToPreload.size} objects`);
      for (const id of idsToPreload) {
        try {
          const { classId, numericId } = parseObjectRef(id);
          const pObj = await this.openWithKnownType(numericId, classId);
          this.objectCache.set(id, pObj);
        } catch (err) {
          debugLog(`[bulkUpdate] pre-fetch failed for ${id}: ${(err as Error).message}`);
        }
      }
    }

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
          const oldParentClassId = pObj?.wClass_Parent;
          const oldParentNumericId = pObj?.twParentIx;
          const oldParentId = oldParentClassId && oldParentNumericId
            ? formatObjectRef(oldParentClassId, oldParentNumericId)
            : null;
          await this.moveObject(moveParams.objectId, moveParams.newParentId, true);
          if (oldParentId) staleParentIds.add(oldParentId);
          staleParentIds.add(moveParams.newParentId);
          return null;
        }
      }
    };

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
        }
      }
    }

    // Re-fetch stale parents so cache reflects new children
    if (staleParentIds.size > 0) {
      for (const parentId of staleParentIds) {
        if (parentId === 'root') continue;
        try {
          this.objectCache.delete(parentId);
          const { classId, numericId } = parseObjectRef(parentId);
          const pParent = await this.openWithKnownType(numericId, classId);
          this.objectCache.set(parentId, pParent);
        } catch {
          // Parent refresh is best-effort
        }
      }
    }

    return { success, failed, createdIds, errors };
  }

  private async loadFullTree(scopeId: string): Promise<FabricObject[]> {
    if (!this.objectCache.has(scopeId)) {
      const { classId, numericId } = parseObjectRef(scopeId);
      const pScene = await this.openWithKnownType(numericId, classId);
      this.objectCache.set(scopeId, pScene);
    }

    const objects: FabricObject[] = [];
    const seenIds = new Set<string>();

    const collectObjects = async (pObject: any): Promise<void> => {
      const prefixedId = this.getPrefixedId(pObject);
      if (seenIds.has(prefixedId)) return;
      seenIds.add(prefixedId);

      objects.push(this.rmxToFabricObject(pObject));

      const children: any[] = [];
      this.enumAllChildTypes(pObject, (child: any) => {
        children.push(child);
      });

      const unopened = children.filter(c => {
        const childPrefixedId = this.getPrefixedId(c);
        return !seenIds.has(childPrefixedId) && !this.objectCache.has(childPrefixedId);
      });
      await Promise.all(unopened.map(child =>
        this.openWithKnownType(child.twObjectIx, child.wClass_Object).catch(() => {})
      ));

      await Promise.all(children.map(child => collectObjects(child)));
    };

    const pScene = this.objectCache.get(scopeId);
    if (pScene) {
      await collectObjects(pScene);
    }

    return objects;
  }

  async findObjects(scopeId: string, query: SearchQuery): Promise<FabricObject[]> {
    await this.ensureConnected();

    // Use server-side SEARCH when we have a text query
    if (query.namePattern) {
      return this.serverSearch(scopeId, query);
    }

    // Fall back to client-side filtering for non-text queries
    const allObjects = await this.loadFullTree(scopeId);
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

  private async serverSearch(scopeId: string, query: SearchQuery): Promise<FabricObject[]> {
    let pScene = this.objectCache.get(scopeId);
    if (!pScene) {
      const { classId, numericId } = parseObjectRef(scopeId);
      pScene = await this.openWithKnownType(numericId, classId);
      this.objectCache.set(scopeId, pScene);
    }

    const pIAction = pScene.Request('SEARCH');
    if (!pIAction) {
      // SEARCH not available on this object type, fall back to full tree
      const allObjects = await this.loadFullTree(scopeId);
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
      throw new Error(this.formatResponseError('Search failed', response));
    }

    const results: FabricObject[] = [];
    const resultSet = response.aResultSet?.[0] || [];
    for (const item of resultSet) {
      // Construct prefixed ID from whichever ID field is present
      let resultObjectId: string | null = null;
      if (item.twRMPObjectIx) {
        resultObjectId = formatObjectRef(ClassIds.RMPObject, item.twRMPObjectIx);
      } else if (item.twRMTObjectIx) {
        resultObjectId = formatObjectRef(ClassIds.RMTObject, item.twRMTObjectIx);
      } else if (item.twRMCObjectIx) {
        resultObjectId = formatObjectRef(ClassIds.RMCObject, item.twRMCObjectIx);
      }
      if (resultObjectId) {
        try {
          const obj = await this.getObject(resultObjectId);
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

  private static readonly TERM_SUBSTITUTIONS: [RegExp, string][] = [
    [/\bRMCObject\b/gi, 'celestial'],
    [/\bRMTObject\b/gi, 'terrestrial'],
    [/\bRMPObject\b/gi, 'physical'],
    [/\bRMRoot\b/gi, 'root'],
    [/\btwRMCObjectIx_Close\b/g, 'celestial object'],
    [/\btwRMTObjectIx_Close\b/g, 'terrestrial object'],
    [/\btwRMPObjectIx_Close\b/g, 'physical object'],
    [/\btwRMCObjectIx\b/g, 'celestial object ID'],
    [/\btwRMTObjectIx\b/g, 'terrestrial object ID'],
    [/\btwRMPObjectIx\b/g, 'physical object ID'],
    [/\btwRMRootIx\b/g, 'root ID'],
    [/\btwRPersonaIx\b/g, 'session ID'],
    [/\bType_bType\b/g, 'objectType'],
    [/\bType_bSubtype\b/g, 'objectSubtype'],
    [/\bType_bFiction\b/g, 'fiction flag'],
    [/\bType_bMovable\b/g, 'movable flag'],
    [/\bwClass\b/g, 'object class'],
    [/\bSURFACE\b/g, 'celestial:surface'],
    [/\bPARCEL\b/g, 'terrestrial:parcel'],
    [/\bRMCOBJECT_OPEN\b/g, 'create celestial child'],
    [/\bRMTOBJECT_OPEN\b/g, 'create terrestrial child'],
    [/\bRMPOBJECT_OPEN\b/g, 'create physical child'],
    [/\bRMCOBJECT_CLOSE\b/g, 'delete celestial child'],
    [/\bRMTOBJECT_CLOSE\b/g, 'delete terrestrial child'],
    [/\bRMPOBJECT_CLOSE\b/g, 'delete physical child'],
  ];

  private static readonly ERROR_REWRITES: [RegExp, string][] = [
    [/Parent's Type_bType must be equal to SURFACE when its parent's class is RMCOBJECT/,
      'celestial:surface is the only celestial type that accepts terrestrial children'],
    [/Parent's Type_bType must be equal to PARCEL when its parent's class is RMTOBJECT/,
      'terrestrial:parcel is the only terrestrial type that accepts physical children'],
  ];

  private translateError(raw: string): string {
    for (const [pattern, replacement] of MVFabricClient.ERROR_REWRITES) {
      if (pattern.test(raw)) return replacement;
    }
    let translated = raw;
    for (const [pattern, replacement] of MVFabricClient.TERM_SUBSTITUTIONS) {
      translated = translated.replace(pattern, replacement);
    }
    return translated;
  }

  private formatResponseError(operation: string, response: any): string {
    const details: string[] = [];
    const resultSet = response.aResultSet?.[0];
    if (Array.isArray(resultSet)) {
      for (const row of resultSet) {
        if (row?.sError) {
          details.push(this.translateError(row.sError));
        }
      }
    }
    const suffix = details.length > 0 ? `: ${details.join('; ')}` : '';
    return `${operation}: error ${response.nResult}${suffix}`;
  }

  private sendAction(pObject: any, actionName: string, fillPayload: (payload: any) => void, timeoutMs: number = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const pIAction = pObject.Request(actionName);
      if (!pIAction) {
        reject(new Error(`Cannot ${this.translateError(actionName)} under this parent type`));
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
      if (child?.twObjectIx && child?.wClass_Object) {
        childIds.push(formatObjectRef(child.wClass_Object, child.twObjectIx));
      }
    });
    return childIds;
  }

  private rmxToFabricObject(rmx: any): FabricObject {
    const id = this.getPrefixedId(rmx);
    const name = this.getObjectName(rmx);
    const nChildren = rmx.nChildren ?? 0;
    const childIds = this.getChildIds(rmx);
    // If nChildren > 0 but no children enumerated, they haven't been loaded yet
    const children = (nChildren > 0 && childIds.length === 0) ? null : childIds;
    const parentId = rmx.twParentIx && rmx.wClass_Parent
      ? formatObjectRef(rmx.wClass_Parent, rmx.twParentIx)
      : null;
    return {
      id,
      parentId,
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
      subtype: rmx.pType?.bType ?? 0,
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
