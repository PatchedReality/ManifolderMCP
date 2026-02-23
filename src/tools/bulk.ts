import { z } from 'zod';
import type { IManifolderPromiseClient } from '../client/ManifolderClient.js';
import type { BulkOperation } from '../types.js';
import { objectTypeSchema, transformFields, celestialFields } from './schemas.js';
import { toolError } from './errors.js';
import { asMCPClient } from './mcp-client.js';

const operationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create'),
    params: z.object({
      parentId: z.string(),
      name: z.string(),
      ...transformFields,
      ...celestialFields,
      objectType: objectTypeSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal('update'),
    params: z.object({
      objectId: z.string(),
      name: z.string().optional(),
      ...transformFields,
      ...celestialFields,
    }),
  }),
  z.object({
    type: z.literal('delete'),
    params: z.object({
      objectId: z.string(),
    }),
  }),
  z.object({
    type: z.literal('move'),
    params: z.object({
      objectId: z.string(),
      newParentId: z.string(),
    }),
  }),
]);

export const bulkTools = {
  bulk_update: {
    description: 'Execute cross-scope batches: `scopeBatches[{ scopeId, operations }]`. Batches and operations run sequentially in best-effort mode. Operations must not depend on IDs produced earlier in the same request.',
    inputSchema: z.object({
      scopeBatches: z.array(z.object({
        scopeId: z.string(),
        operations: z.array(operationSchema),
      })).describe('Array of per-scope operation batches'),
    }),
  },
};

export async function handleBulkUpdate(
  client: IManifolderPromiseClient,
  args: { scopeBatches: Array<{ scopeId: string; operations: BulkOperation[] }> }
): Promise<string> {
  const mcpClient = asMCPClient(client);
  const scopeIds = args.scopeBatches.map((batch) => batch.scopeId);
  if (new Set(scopeIds).size !== scopeIds.length) {
    throw toolError({
      code: 'SCOPE_TARGET_CONFLICT',
      message: 'Each scopeId may appear at most once in scopeBatches.',
    });
  }

  const batches: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];
  let total = 0;
  let succeeded = 0;
  let failed = 0;

  for (const batch of args.scopeBatches) {
    total += batch.operations.length;
    try {
      const result = await mcpClient.bulkUpdate({ scopeId: batch.scopeId, operations: batch.operations });
      succeeded += result.success;
      failed += result.failed;
      if (result.errors.length > 0) {
        errors.push(...result.errors.map((message: string) => ({ scopeId: batch.scopeId, message })));
      }
      batches.push({
        scopeId: batch.scopeId,
        ...result,
      });
    } catch (error) {
      failed += batch.operations.length;
      const message = (error as Error).message;
      errors.push({ scopeId: batch.scopeId, message });
      batches.push({
        scopeId: batch.scopeId,
        success: 0,
        failed: batch.operations.length,
        createdIds: [],
        errors: [message],
      });
    }
  }

  let code: string;
  if (succeeded > 0 && failed > 0) {
    code = 'CROSS_SCOPE_PARTIAL_FAILURE';
  } else if (succeeded === 0 && failed > 0) {
    code = 'CROSS_SCOPE_FAILURE';
  } else {
    code = 'OK';
  }

  return JSON.stringify({
    code,
    batches,
    summary: { total, succeeded, failed },
    errors,
  });
}
