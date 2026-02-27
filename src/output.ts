/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

const DEFAULT_LIMIT = 10;

export interface PagedResult<T> {
  total: number;
  offset: number;
  limit: number;
  items: T[];
}

export function paginate<T>(
  items: T[],
  offset?: number,
  limit?: number,
): PagedResult<T> {
  const o = offset ?? 0;
  const l = limit ?? DEFAULT_LIMIT;
  return {
    total: items.length,
    offset: o,
    limit: l,
    items: items.slice(o, o + l),
  };
}
