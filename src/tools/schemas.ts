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

// Blueprint schemas - arrays for pos/rot/scale/bounds
export const posArraySchema = z.tuple([z.number(), z.number(), z.number()]);
export const rotArraySchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export const scaleArraySchema = z.tuple([z.number(), z.number(), z.number()]);
export const boundsArraySchema = z.tuple([z.number(), z.number(), z.number()]);

// Recursive child blueprint schema
export const blueprintChildSchema: z.ZodType<BlueprintChild> = z.lazy(() =>
  z.object({
    blueprintType: z.literal('physical'),
    resourceName: z.string().optional(),
    resourceReference: z.string().optional(),
    pos: posArraySchema.optional(),
    rot: rotArraySchema.optional(),
    scale: scaleArraySchema.optional(),
    objectBounds: boundsArraySchema.optional(),
    maxBounds: boundsArraySchema.optional(),
    children: z.array(blueprintChildSchema).optional(),
  }).refine(
    (data) => data.resourceName !== undefined || data.resourceReference !== undefined,
    { message: 'Child must have either resourceName or resourceReference' }
  )
);

export interface BlueprintChild {
  blueprintType: 'physical';
  resourceName?: string;
  resourceReference?: string;
  pos?: [number, number, number];
  rot?: [number, number, number, number];
  scale?: [number, number, number];
  objectBounds?: [number, number, number];
  maxBounds?: [number, number, number];
  children?: BlueprintChild[];
}

export const blueprintBodySchema = z.object({
  blueprintType: z.literal('physical'),
  resourceName: z.string(),
  pos: posArraySchema,
  rot: rotArraySchema.optional(),
  scale: scaleArraySchema.optional(),
  objectBounds: boundsArraySchema,
  maxBounds: boundsArraySchema,
  children: z.array(blueprintChildSchema).optional(),
});


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

// Scene action blueprint - resourceName is optional
export const sceneActionBlueprintSchema = z.object({
  blueprintType: z.literal('physical'),
  resourceName: z.string().optional(),
  pos: posArraySchema,
  rot: rotArraySchema.optional(),
  scale: scaleArraySchema.optional(),
  objectBounds: boundsArraySchema.optional(),
  maxBounds: boundsArraySchema.optional(),
  children: z.array(blueprintChildSchema).optional(),
});

export const sceneActionBodySchema = z.object({
  blueprint: sceneActionBlueprintSchema,
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

export const fullSceneActionSchema = z.object({
  header: actionResourceHeader,
  body: sceneActionBodySchema,
});
