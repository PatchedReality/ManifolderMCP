// @ts-nocheck - MVMF libraries are untyped JavaScript
import '../vendor/mv/index.js';

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

declare const MV: any;

// Handler class that extends NOTIFICATION to receive all callbacks properly
class ClientHandler extends MV.MVMF.NOTIFICATION {
  private client: MVFabricClient;
  private pendingReady: Map<any, () => void> = new Map();

  constructor(client: MVFabricClient) {
    super();
    this.client = client;
  }

  waitForReady(pObject: any): Promise<void> {
    if (pObject.IsReady()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.pendingReady.set(pObject, resolve);
    });
  }

  onReadyState(pNotice: any) {
    this.client._handleReadyState(pNotice);

    // Check if any pending object is now ready
    if (pNotice.pCreator?.IsReady()) {
      const resolve = this.pendingReady.get(pNotice.pCreator);
      if (resolve) {
        this.pendingReady.delete(pNotice.pCreator);
        resolve();
      }
    }
  }

  onInserted(pNotice: any) {
    // Handle child insertions if needed
  }

  onUpdated(pNotice: any) {
    // Handle updates if needed
  }

  onChanged(pNotice: any) {
    // Handle changes if needed
  }

  onDeleting(pNotice: any) {
    // Handle deletions if needed
  }
}

export class MVFabricClient implements IFabricClient {
  private pFabric: any = null;
  private pLnG: any = null;
  private pRMRoot: any = null;
  private connected = false;
  private loggedIn = false;
  private profile: string | null = null;
  private fabricUrl: string | null = null;
  private currentSceneId: string | null = null;
  private adminKey: string | null = null;

  private objectCache: Map<string, any> = new Map();
  private handler: ClientHandler;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;

  constructor() {
    this.handler = new ClientHandler(this);
  }

  async connect(fabricUrl: string, adminKey: string): Promise<void> {
    this.fabricUrl = fabricUrl;
    this.adminKey = adminKey;

    return new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;

      this.pFabric = new MV.MVRP.MSF(fabricUrl, MV.MVRP.MSF.eMETHOD.GET);
      this.pFabric.Attach(this.handler);
    });
  }

  // Called by ClientHandler.onReadyState
  _handleReadyState(pNotice: any) {
    if (pNotice.pCreator === this.pFabric) {
      if (this.pFabric.IsReady()) {
        this.pLnG = this.pFabric.GetLnG('map');
        if (!this.pLnG) {
          this.connectReject?.(new Error('Failed to get LnG "map" from fabric config'));
          return;
        }
        this.pLnG.Attach(this.handler);
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
        this.pLnG.Login('token=' + MV.MVMF.Escape(this.adminKey));
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
    this.pRMRoot.Attach(this.handler);
  }

  private waitForRootReady(): Promise<void> {
    return this.handler.waitForReady(this.pRMRoot);
  }

  private async openAndWait(modelType: string, objectId: number): Promise<any> {
    const pObject = this.pLnG.Model_Open(modelType, objectId);
    pObject.Attach(this.handler);
    await this.handler.waitForReady(pObject);
    return pObject;
  }

  async disconnect(): Promise<void> {
    if (this.pRMRoot) {
      this.pLnG.Model_Close(this.pRMRoot);
      this.pRMRoot = null;
    }
    if (this.pLnG) {
      this.pLnG = null;
    }
    if (this.pFabric) {
      await this.pFabric.destructor();
      this.pFabric = null;
    }
    this.connected = false;
    this.loggedIn = false;
    this.fabricUrl = null;
    this.profile = null;
    this.currentSceneId = null;
    this.objectCache.clear();
  }

  getStatus(): ConnectionStatus {
    return {
      connected: this.connected,
      profile: this.profile,
      fabricUrl: this.fabricUrl,
      currentSceneId: this.currentSceneId,
      currentSceneName: null,
    };
  }

  async listScenes(): Promise<Scene[]> {
    this.ensureConnected();
    await this.waitForRootReady();

    const scenes: Scene[] = [];
    const enumCallback = (pRMXObject: any) => {
      scenes.push({
        id: pRMXObject.twObjectIx.toString(),
        name: pRMXObject.pName?.wsRMPObjectId || `Scene ${pRMXObject.twObjectIx}`,
        rootObjectId: pRMXObject.twObjectIx.toString(),
      });
    };

    this.pRMRoot.Child_Enum('RMPObject', this, enumCallback, null);
    return scenes;
  }

  async openScene(sceneId: string): Promise<RMPObject> {
    this.ensureConnected();

    const twObjectIx = parseInt(sceneId);
    const pObject = await this.openAndWait('RMPObject', twObjectIx);

    this.currentSceneId = sceneId;
    this.objectCache.set(sceneId, pObject);

    return this.rmxToRMPObject(pObject);
  }

  async createScene(name: string): Promise<Scene> {
    this.ensureConnected();
    await this.waitForRootReady();

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
    await this.waitForRootReady();

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

  async listObjects(sceneId: string, filter?: ObjectFilter): Promise<RMPObject[]> {
    this.ensureConnected();

    let pScene = this.objectCache.get(sceneId);
    if (!pScene) {
      pScene = await this.openAndWait('RMPObject', parseInt(sceneId));
      this.objectCache.set(sceneId, pScene);
    }

    const objects: RMPObject[] = [];
    const collectObjects = (pObject: any) => {
      objects.push(this.rmxToRMPObject(pObject));
      pObject.Child_Enum('RMPObject', this, collectObjects, null);
    };

    collectObjects(pScene);

    if (filter?.namePattern) {
      const pattern = new RegExp(filter.namePattern, 'i');
      return objects.filter(obj => pattern.test(obj.name));
    }

    return objects;
  }

  async getObject(objectId: string): Promise<RMPObject> {
    this.ensureConnected();

    let pObject = this.objectCache.get(objectId);
    if (!pObject) {
      pObject = await this.openAndWait('RMPObject', parseInt(objectId));
      this.objectCache.set(objectId, pObject);
    }

    return this.rmxToRMPObject(pObject);
  }

  async createObject(params: CreateObjectParams): Promise<RMPObject> {
    this.ensureConnected();

    let pParent = this.objectCache.get(params.parentId);
    if (!pParent) {
      pParent = await this.openAndWait('RMPObject', parseInt(params.parentId));
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
      payload.pResource.sName = '';
      payload.pResource.sReference = params.resource || '';
      payload.pTransform.vPosition.dX = params.position?.x || 0;
      payload.pTransform.vPosition.dY = params.position?.y || 0;
      payload.pTransform.vPosition.dZ = params.position?.z || 0;
      payload.pTransform.qRotation.dX = params.rotation?.x || 0;
      payload.pTransform.qRotation.dY = params.rotation?.y || 0;
      payload.pTransform.qRotation.dZ = params.rotation?.z || 0;
      payload.pTransform.qRotation.dW = params.rotation?.w || 1;
      payload.pTransform.vScale.dX = params.scale?.x || 1;
      payload.pTransform.vScale.dY = params.scale?.y || 1;
      payload.pTransform.vScale.dZ = params.scale?.z || 1;
      payload.pBound.dX = 1;
      payload.pBound.dY = 1;
      payload.pBound.dZ = 1;
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
        position: params.position || { x: 0, y: 0, z: 0 },
        rotation: params.rotation || { x: 0, y: 0, z: 0, w: 1 },
        scale: params.scale || { x: 1, y: 1, z: 1 },
      },
      resource: params.resource || null,
      bound: null,
      classId: ClassIds.RMPObject,
      children: [],
    };
  }

  async updateObject(params: UpdateObjectParams): Promise<RMPObject> {
    this.ensureConnected();

    let pObject = this.objectCache.get(params.objectId);
    if (!pObject) {
      pObject = await this.openAndWait('RMPObject', parseInt(params.objectId));
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
      const response = await this.sendAction(pObject, 'RESOURCE', (payload: any) => {
        payload.pResource.sReference = params.resource;
      });
      if (response.nResult !== 0) {
        throw new Error(`Failed to update resource: error ${response.nResult}`);
      }
    }

    return this.getObject(params.objectId);
  }

  async deleteObject(objectId: string): Promise<void> {
    this.ensureConnected();

    const pObject = this.objectCache.get(objectId);
    if (!pObject) {
      throw new Error(`Object not found in cache: ${objectId}`);
    }

    const parentId = pObject.twParentIx.toString();
    let pParent = this.objectCache.get(parentId);
    if (!pParent) {
      pParent = await this.openAndWait('RMPObject', pObject.twParentIx);
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
      pObject = await this.openAndWait('RMPObject', parseInt(objectId));
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

  async findObjects(sceneId: string, query: SearchQuery): Promise<RMPObject[]> {
    const allObjects = await this.listObjects(sceneId);

    return allObjects.filter(obj => {
      if (query.namePattern) {
        const pattern = new RegExp(query.namePattern, 'i');
        if (!pattern.test(obj.name)) return false;
      }
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

  private rmxToRMPObject(rmx: any): RMPObject {
    return {
      id: rmx.twObjectIx.toString(),
      parentId: rmx.twParentIx ? rmx.twParentIx.toString() : null,
      name: rmx.pName?.wsRMPObjectId || `Object ${rmx.twObjectIx}`,
      transform: {
        position: {
          x: rmx.pTransform?.vPosition?.dX || 0,
          y: rmx.pTransform?.vPosition?.dY || 0,
          z: rmx.pTransform?.vPosition?.dZ || 0,
        },
        rotation: {
          x: rmx.pTransform?.qRotation?.dX || 0,
          y: rmx.pTransform?.qRotation?.dY || 0,
          z: rmx.pTransform?.qRotation?.dZ || 0,
          w: rmx.pTransform?.qRotation?.dW || 1,
        },
        scale: {
          x: rmx.pTransform?.vScale?.dX || 1,
          y: rmx.pTransform?.vScale?.dY || 1,
          z: rmx.pTransform?.vScale?.dZ || 1,
        },
      },
      resource: rmx.pResource?.sReference || null,
      bound: rmx.pBound ? {
        min: { x: -rmx.pBound.dX / 2, y: -rmx.pBound.dY / 2, z: -rmx.pBound.dZ / 2 },
        max: { x: rmx.pBound.dX / 2, y: rmx.pBound.dY / 2, z: rmx.pBound.dZ / 2 },
      } : null,
      classId: rmx.wClass_Object,
      children: [],
    };
  }
}
