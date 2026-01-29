import { z } from 'zod';
import { readFile } from 'fs/promises';
import {
  fullPointlightSchema,
  fullShowtextSchema,
  fullRotatorSchema,
  fullVideoSchema,
  fullSceneActionSchema,
} from './schemas.js';

export const actionResourceTypes = ['pointlight', 'showtext', 'rotator', 'scene', 'video'] as const;
export type ActionResourceType = typeof actionResourceTypes[number];

const schemaMap: Record<ActionResourceType, z.ZodType> = {
  pointlight: fullPointlightSchema,
  showtext: fullShowtextSchema,
  rotator: fullRotatorSchema,
  scene: fullSceneActionSchema,
  video: fullVideoSchema,
};

export const templateResourceTools = {
  get_template_resource_schema: {
    description: 'Get the expected structure for creating template resources (reusable scene fragments). Template resources are JSON files that define arrangements of objects that can be instantiated multiple times in scenes.',
    inputSchema: z.object({}),
  },
  validate_template_resource: {
    description: 'Validate a template resource JSON file against its schema. Template resources define reusable scene fragments (action://scene), lights (action://pointlight), text (action://showtext), rotators (action://rotator), or video (action://video).',
    inputSchema: z.object({
      filePath: z.string().describe('Path to the JSON file to validate'),
      type: z.enum(actionResourceTypes).describe('Resource type to validate against'),
    }),
  },
};

export function handleGetTemplateResourceSchema(): string {
  return JSON.stringify({
    description: 'Template resource formats for Fabric. Template resources are JSON files that define reusable content (scene fragments, lights, text, etc.) that can be referenced by objects in your scenes.',
    commonStructure: {
      header: { type: 'DATA' },
      body: '{ ... type-specific content ... }',
    },
    types: {
      pointlight: {
        reference: 'action://pointlight',
        body: {
          color: '[R, G, B, intensity] - RGBA with intensity as 4th component',
          timeofday: 'boolean (optional) - whether light follows time of day',
        },
      },
      showtext: {
        reference: 'action://showtext',
        body: {
          text: 'string - text to display',
          align: 'string (optional) - text alignment',
        },
      },
      rotator: {
        reference: 'action://rotator',
        body: {
          parent: 'number (optional) - parent index',
          rotSpeed: 'number - rotation speed',
          axis: '[x, y, z] - rotation axis',
        },
      },
      scene: {
        reference: 'action://scene',
        body: {
          blueprint: {
            blueprintType: 'physical',
            resourceName: 'string (optional) - identifier for this scene',
            pos: '[x, y, z] - position offset',
            rot: '[x, y, z, w] - quaternion rotation (optional)',
            scale: '[x, y, z] - scale (optional)',
            objectBounds: '[x, y, z] - object bounding box (optional)',
            maxBounds: '[x, y, z] - maximum bounds (optional)',
            children: 'array of child objects (optional)',
          },
        },
        childSchema: {
          blueprintType: 'physical',
          resourceName: 'string (optional)',
          resourceReference: 'string - URL like "glb/tiles/foo.metadata.json" or "action://scene" (optional)',
          pos: '[x, y, z] (optional)',
          rot: '[x, y, z, w] (optional)',
          scale: '[x, y, z] (optional)',
          objectBounds: '[x, y, z] (optional)',
          maxBounds: '[x, y, z] (optional)',
          children: 'nested children (optional)',
        },
        notes: ['Children must have either resourceName or resourceReference'],
      },
      video: {
        reference: 'action://video',
        body: {
          streamConfig: {
            sources: 'string[] - array of video source URLs',
          },
        },
      },
    },
    notes: [
      'All template resources share the common header: { type: "DATA" }',
      'Use upload_resource to upload the JSON file, then instantiate with create_object using resource: "action://scene" and resourceName: "/objects/myTemplate.json"',
      'The "scene" type is most commonly used for reusable arrangements of objects (e.g., a cluster of trees, a furniture set)',
    ],
  }, null, 2);
}

export async function handleValidateTemplateResource(args: { filePath: string; type: ActionResourceType }): Promise<string> {
  const content = await readFile(args.filePath, 'utf-8');
  const resource = JSON.parse(content);
  const schema = schemaMap[args.type];
  const result = schema.safeParse(resource);

  if (result.success) {
    return JSON.stringify({ valid: true, type: args.type });
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  return JSON.stringify({ valid: false, type: args.type, errors });
}
