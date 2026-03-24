/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { ObjectTypeMap, ClassIdToPrefix } from '../types.js';

export const vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const latLonSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const quaternionSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  w: z.number(),
});

export const transformFields = {
  position: vector3Schema.optional().describe('Y-up coordinate system: X = east, Y = up, Z = north. Ground plane is y = 0.'),
  rotation: quaternionSchema.optional(),
  scale: vector3Schema.optional(),
  resourceReference: z.string().optional().describe('Resource URL (maps to pResource.sReference). Use the url from upload_resource or list_resources. For action resources: "action://pointlight"'),
  resourceName: z.string().optional(),
  bound: vector3Schema.optional().describe('Spatial extent in meters. Y-up: X = east, Y = up, Z = north. Terrestrial/physical: x/z are half-extent, y is full height above ground. Celestial: x/y/z are all half-extent (radius). Examples: Earth = {x:6371000, y:6371000, z:6371000}, a 100m×50m parcel 20m tall = {x:50, y:20, z:25}'),
};

export const orbitSchema = z.object({
  period: z.number().describe('Orbit period in 1/64-second ticks (days × 86400 × 64 = days × 5529600)'),
  start: z.number().describe('Orbit start time in 1/64-second ticks'),
  a: z.number().describe('Semi-major axis in meters (km × 1000)'),
  b: z.number().describe('Semi-minor axis in meters (km × 1000). b = a × sqrt(1 - e²)'),
}).optional();

export const celestialPropertiesSchema = z.object({
  mass: z.number(),
  gravity: z.number(),
  color: z.number(),
  brightness: z.number(),
  reflectivity: z.number(),
}).optional();

export const celestialFields = {
  orbit: orbitSchema,
  properties: celestialPropertiesSchema,
};

export const scopeTargetParams = {
  scopeId: z.string().optional(),
  profile: z.string().optional(),
  url: z.string().optional(),
};

export const findEarthAttachmentParentSchema = z.object({
  ...scopeTargetParams,
  anchorObjectId: z.string().optional().describe('Object ID to scope the search to. Defaults to the terrestrial root.'),
  lat: z.number().min(-90).max(90).optional().describe('Campus center latitude in degrees (WGS84)'),
  lon: z.number().min(-180).max(180).optional().describe('Campus center longitude in degrees (WGS84)'),
  boundX: z.number().min(1).optional().describe('Campus east-west half-extent in meters (same semantics as bound.x on objects)'),
  boundZ: z.number().min(1).optional().describe('Campus north-south half-extent in meters (same semantics as bound.z on objects)'),
  boundY: z.number().min(1).optional().describe('Campus height in meters (optional — derived from sector subtype if omitted)'),
  nodes: z.array(latLonSchema).min(2).optional().describe('Perimeter nodes (minimum 2). If provided, center, width, and depth are computed from them.'),
  city: z.string().optional(),
  community: z.string().optional(),
  county: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.nodes && value.nodes.length >= 4) {
    return;
  }
  if (typeof value.lat !== 'number') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lat'], message: 'lat is required when nodes are not provided' });
  }
  if (typeof value.lon !== 'number') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lon'], message: 'lon is required when nodes are not provided' });
  }
  if (typeof value.boundX !== 'number') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['boundX'], message: 'boundX is required when nodes are not provided' });
  }
  if (typeof value.boundZ !== 'number') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['boundZ'], message: 'boundZ is required when nodes are not provided' });
  }
});

// Reverse lookup: "${classId}:${type}" → "class:type" string
export const ReverseObjectTypeMap: Record<string, string> = {};
for (const [key, value] of Object.entries(ObjectTypeMap)) {
  ReverseObjectTypeMap[`${value.classId}:${value.type}`] = key;
}

const validObjectTypes = Object.keys(ObjectTypeMap).sort();

/**
 * Resolve a composite objectType string (e.g. "celestial:star:attachment") into
 * the client-level objectType and numeric subtype for the ManifolderClient API.
 */
export function resolveCompositeObjectType(compositeType: string): { objectType: string; subtype: number } {
  const parsed = parseObjectType(compositeType);
  const objectType = ReverseObjectTypeMap[`${parsed.classId}:${parsed.type}`] ?? compositeType;
  return { objectType, subtype: parsed.subtype };
}

export function parseObjectType(objectType: string): { classId: number; type: number; subtype: number } {
  // Try exact match first
  const exact = ObjectTypeMap[objectType];
  if (exact) {
    return { classId: exact.classId, type: exact.type, subtype: 0 };
  }
  // Split at last colon to separate potential subtype suffix
  const lastColon = objectType.lastIndexOf(':');
  if (lastColon === -1) {
    throw new Error(`Unknown objectType "${objectType}". Valid base types: ${validObjectTypes.join(', ')}`);
  }
  const base = objectType.substring(0, lastColon);
  const suffix = objectType.substring(lastColon + 1);
  const baseInfo = ObjectTypeMap[base];
  if (!baseInfo) {
    throw new Error(`Unknown objectType "${objectType}". Valid base types: ${validObjectTypes.join(', ')}`);
  }
  if (suffix === 'attachment') {
    return { classId: baseInfo.classId, type: baseInfo.type, subtype: 255 };
  }
  const subtypeNum = parseInt(suffix, 10);
  if (isNaN(subtypeNum) || subtypeNum < 0 || subtypeNum > 255) {
    throw new Error(`Invalid subtype "${suffix}" in objectType "${objectType}". Must be 0-255 or "attachment".`);
  }
  return { classId: baseInfo.classId, type: baseInfo.type, subtype: subtypeNum };
}

function appendSubtype(base: string, subtype: number): string {
  if (subtype === 0) return base;
  if (subtype === 255) return `${base}:attachment`;
  return `${base}:${subtype}`;
}

export function formatObjectType(classId: number, type: number, subtype: number): string {
  const base = ReverseObjectTypeMap[`${classId}:${type}`];
  if (!base) {
    const prefix = ClassIdToPrefix[classId] ?? `class${classId}`;
    const fallback = type === 0 ? prefix : `${prefix}:type${type}`;
    return appendSubtype(fallback, subtype);
  }
  return appendSubtype(base, subtype);
}

const objectTypeDescription = `Object type in "class:type" or "class:type:subtype" format. ` +
  `Valid base types: ${validObjectTypes.join(', ')}. ` +
  `Append ":attachment" for attachment points (subtype 255) or ":<number>" for explicit subtype (0-254). ` +
  `Examples: "terrestrial:parcel", "celestial:surface:attachment", "celestial:star_cluster:3". ` +
  `Defaults to "physical:default" when omitted.`;

export const objectTypeSchema = z.string().refine(
  (val) => {
    try {
      parseObjectType(val);
      return true;
    } catch {
      return false;
    }
  },
  { message: `Invalid objectType. ${objectTypeDescription}` }
).describe(objectTypeDescription);

// Action body schemas
export const pointlightBodySchema = z.object({
  color: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  timeofday: z.boolean().optional(),
});

export const showtextBodySchema = z.object({
  text: z.string(),
  align: z.string().optional(),
});

export const rotatorBodySchema = z.object({
  parent: z.number().optional(),
  rotSpeed: z.number(),
  axis: z.tuple([z.number(), z.number(), z.number()]),
});

export const videoBodySchema = z.object({
  streamConfig: z.object({
    sources: z.array(z.string()),
  }),
});

// Full action resource schemas with header wrapper
export const actionResourceHeader = z.object({
  type: z.literal('DATA'),
});

export const fullPointlightSchema = z.object({
  header: actionResourceHeader,
  body: pointlightBodySchema,
});

export const fullShowtextSchema = z.object({
  header: actionResourceHeader,
  body: showtextBodySchema,
});

export const fullRotatorSchema = z.object({
  header: actionResourceHeader,
  body: rotatorBodySchema,
});

export const fullVideoSchema = z.object({
  header: actionResourceHeader,
  body: videoBodySchema,
});
