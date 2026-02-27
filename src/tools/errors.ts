/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ToolErrorShape {
  code: string;
  message: string;
  scopeId?: string;
  nodeUid?: string;
  details?: Record<string, unknown>;
}

export class ToolError extends Error {
  code: string;
  scopeId?: string;
  nodeUid?: string;
  details?: Record<string, unknown>;

  constructor(shape: ToolErrorShape) {
    super(shape.message);
    this.name = 'ToolError';
    this.code = shape.code;
    this.scopeId = shape.scopeId;
    this.nodeUid = shape.nodeUid;
    this.details = shape.details;
  }
}

export function toolError(shape: ToolErrorShape): ToolError {
  return new ToolError(shape);
}

export function serializeToolError(error: unknown): ToolErrorShape {
  if (error instanceof ToolError) {
    return {
      code: error.code,
      message: error.message,
      scopeId: error.scopeId,
      nodeUid: error.nodeUid,
      details: error.details,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const shape: ToolErrorShape = {
    code: 'UNEXPECTED_ERROR',
    message,
  };

  if (error && typeof error === 'object') {
    const adhoc = error as Partial<ToolErrorShape> & { message?: unknown };
    if (typeof adhoc.code === 'string') {
      shape.code = adhoc.code;
    }
    if (typeof adhoc.message === 'string' && !(error instanceof Error)) {
      shape.message = adhoc.message;
    }
    if (typeof adhoc.scopeId === 'string') {
      shape.scopeId = adhoc.scopeId;
    }
    if (typeof adhoc.nodeUid === 'string') {
      shape.nodeUid = adhoc.nodeUid;
    }
    if (adhoc.details && typeof adhoc.details === 'object' && !Array.isArray(adhoc.details)) {
      shape.details = adhoc.details as Record<string, unknown>;
    }
  }

  return shape;
}
