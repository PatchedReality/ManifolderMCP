/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import type { IManifolderPromiseClient } from '../client/index.js';
import { loadConfig } from '../config.js';
import { resolveScopeTarget } from './scope-target.js';
import { scopeTargetParams } from './schemas.js';

export const connectionTools = {
  list_profiles: {
    description: 'List available Fabric connection profiles from config',
    inputSchema: z.object({}),
  },
  fabric_status: {
    description: 'Get scope status. Accepts scope target params; if omitted, read/status fallback applies to a single connected root scope.',
    inputSchema: z.object({
      ...scopeTargetParams,
    }),
  },
};

export async function handleListProfiles(): Promise<string> {
  const config = await loadConfig();
  const profiles = Object.entries(config).map(([name, profile]) => ({
    name,
    fabricUrl: profile.fabricUrl,
  }));
  return JSON.stringify({ profiles });
}

export async function handleFabricStatus(
  client: IManifolderPromiseClient,
  args: { scopeId?: string; profile?: string; url?: string }
): Promise<string> {
  const target = await resolveScopeTarget(args, client, {
    allowImplicitFallback: true,
    isCUD: false,
  });
  return JSON.stringify(client.getScopeStatus({ scopeId: target.scopeId }));
}
