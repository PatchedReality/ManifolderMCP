import type { FabricObject, Scene } from '../types.js';
import { parseObjectRef } from '../types.js';

export function shapeObjectResponse(scopeId: string, obj: FabricObject): Record<string, unknown> {
  return {
    scopeId,
    id: obj.id,
    nodeUid: obj.nodeUid ?? null,
    parentId: obj.parentId,
    parentNodeUid: obj.parentNodeUid ?? null,
    name: obj.name,
    position: obj.transform.position,
    rotation: obj.transform.rotation,
    scale: obj.transform.scale,
    resourceReference: obj.resourceReference,
    resourceName: obj.resourceName,
    bound: obj.bound,
    childCount: obj.children === null ? -1 : obj.children.length,
    children: obj.children,
    orbit: obj.orbit,
    properties: obj.properties,
  };
}

export function shapeSceneSummary(scopeId: string, scene: Scene & { id: string }, resourceRootUrl: string): Record<string, unknown> {
  const { classId, numericId } = parseObjectRef(scene.id);
  const normalizedRoot = resourceRootUrl.endsWith('/') ? resourceRootUrl.slice(0, -1) : resourceRootUrl;
  return {
    scopeId,
    id: scene.id,
    name: scene.name,
    rootObjectId: scene.rootObjectId,
    classId: scene.classId,
    url: `${normalizedRoot}/fabric/${classId}/${numericId}`,
  };
}