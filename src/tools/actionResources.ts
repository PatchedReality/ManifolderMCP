import { z } from 'zod';
import { readFile } from 'fs/promises';
import {
  fullPointlightSchema,
  fullShowtextSchema,
  fullRotatorSchema,
  fullVideoSchema,
} from './schemas.js';

export const actionResourceTypes = ['pointlight', 'showtext', 'rotator', 'video'] as const;
export type ActionResourceType = typeof actionResourceTypes[number];

const schemaMap: Record<ActionResourceType, z.ZodType> = {
  pointlight: fullPointlightSchema,
  showtext: fullShowtextSchema,
  rotator: fullRotatorSchema,
  video: fullVideoSchema,
};

export const actionResourceTools = {
  get_action_resource_schema: {
    description: 'Get the expected structure for creating action resources. Action resources are JSON files that define lights, text, rotators, or video that can be attached to objects in scenes.',
    inputSchema: z.object({}),
  },
  validate_action_resource: {
    description: 'Validate an action resource JSON file against its schema. Action resources define lights (action://pointlight), text (action://showtext), rotators (action://rotator), or video (action://video).',
    inputSchema: z.object({
      localPath: z.string().describe('Local path to the JSON file to validate'),
      type: z.enum(actionResourceTypes).describe('Resource type to validate against'),
    }),
  },
};

export function handleGetActionResourceSchema(): string {
  return getFullActionResourceSchema();
}

export function getFullActionResourceSchema(): string {
  return JSON.stringify({
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
      'All action resources share the common header: { type: "DATA" }',
      'Use upload_resource to upload the JSON file, then create_object with the action URI (e.g. resourceReference: "action://pointlight") and resourceName set to the url returned by upload_resource',
    ],
  }, null, 2);
}

export async function handleValidateActionResource(args: { localPath: string; type: ActionResourceType }): Promise<string> {
  const content = await readFile(args.localPath, 'utf-8');
  const resource = JSON.parse(content);
  const schema = schemaMap[args.type];
  const result = schema.safeParse(resource);

  if (result.success) {
    return JSON.stringify({ valid: true, type: args.type });
  }

  const errors = result.error.issues.map(({ path, message }) => {
    const location = path.join('.');
    return location ? `${location}: ${message}` : message;
  });

  return JSON.stringify({ valid: false, type: args.type, errors });
}
