import { z } from 'zod';

export const vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const quaternionSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  w: z.number(),
});

export const transformFields = {
  position: vector3Schema.optional(),
  rotation: quaternionSchema.optional(),
  scale: vector3Schema.optional(),
  resourceReference: z.string().optional().describe('Resource URL (maps to pResource.sReference). Use the url from upload_resource or list_resources. For action resources: "action://pointlight"'),
  resourceName: z.string().optional(),
  bound: vector3Schema.optional().describe('Bounding half-extent (radius) in meters. The object extends ±bound from its center on each axis. Examples: Earth = {x:6371000, y:6371000, z:6371000}, a 100m×50m parcel = {x:50, y:10, z:25}'),
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

export const objectTypeSchema = z.enum([
  // Celestial subtypes (class 71)
  'celestial:universe', 'celestial:supercluster', 'celestial:galaxy_cluster',
  'celestial:galaxy', 'celestial:black_hole', 'celestial:nebula',
  'celestial:star_cluster', 'celestial:constellation', 'celestial:star_system',
  'celestial:star', 'celestial:planet_system', 'celestial:planet',
  'celestial:moon', 'celestial:debris', 'celestial:satellite',
  'celestial:transport', 'celestial:surface',
  // Terrestrial subtypes (class 72)
  'terrestrial:root', 'terrestrial:water', 'terrestrial:land',
  'terrestrial:country', 'terrestrial:territory', 'terrestrial:state',
  'terrestrial:county', 'terrestrial:city', 'terrestrial:community',
  'terrestrial:sector', 'terrestrial:parcel',
  // Physical subtypes (class 73)
  'physical', 'physical:transport',
]);

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
