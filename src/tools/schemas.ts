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
  resource: z.string().optional(),
  resourceName: z.string().optional(),
  bound: vector3Schema.optional(),
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
