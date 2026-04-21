/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import type { IManifolderPromiseClient } from '../client/index.js';
import type { BulkOperation } from '../types.js';
import { objectTypeSchema, resolveCompositeObjectType, transformFields, celestialFields } from './schemas.js';
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
      objectType: objectTypeSchema.optional(),
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
    description: 'Execute cross-scope batches: `scopeBatches[{ scopeId, operations }]`. Batches run sequentially; operations within a batch run concurrently (sliding window, up to `options.concurrency`, default 10). Operations must not depend on IDs produced earlier in the same request.',
    inputSchema: z.object({
      scopeBatches: z.array(z.object({
        scopeId: z.string(),
        operations: z.array(operationSchema),
      })).describe('Array of per-scope operation batches'),
      options: z.object({
        concurrency: z.number().int().min(1).max(100).optional()
          .describe('Max concurrent operations within a batch (default: 10)'),
        confirmMode: z.enum(['await', 'optimistic']).optional()
          .describe('"await" waits for mutation confirmation; "optimistic" skips it (default: "await")'),
      }).optional().describe('Performance tuning options'),
    }),
  },
};

export async function handleBulkUpdate(
  client: IManifolderPromiseClient,
  args: {
    scopeBatches: Array<{ scopeId: string; operations: BulkOperation[] }>;
    options?: { concurrency?: number; confirmMode?: 'await' | 'optimistic' };
  }
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
    const resolvedOps = batch.operations.map(function (op) {
      if ((op.type === 'create' || op.type === 'update') && (op.params as Record<string, unknown>).objectType) {
        const { objectType: compositeType, ...rest } = op.params as Record<string, unknown>;
        const resolved = resolveCompositeObjectType(compositeType as string);
        return { ...op, params: { ...rest, ...resolved } };
      }
      return op;
    });
    try {
      const result = await mcpClient.bulkUpdate({ scopeId: batch.scopeId, operations: resolvedOps as BulkOperation[], options: args.options });
      succeeded += result.success;
      failed += result.failed;
      if (result.errors.length > 0) {
        errors.push(...result.errors.map((message: string) => ({ scopeId: batch.scopeId, message })));
      }
      batches.push({
        scopeId: batch.scopeId,
        success: result.success,
        failed: result.failed,
        createdIds: result.createdIds,
        errors: result.errors,
        results: result.results,
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
        results: batch.operations.map((op) => ({ status: 'error' as const, message })),
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
