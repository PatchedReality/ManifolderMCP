import { z } from 'zod';
import type { MVFabricClient } from '../client/MVFabricClient.js';
import { getProfile, loadConfig } from '../config.js';

export const connectionTools = {
  list_profiles: {
    description: 'List available Fabric connection profiles from config',
    inputSchema: z.object({}),
  },
  fabric_connect: {
    description: 'Connect to a Fabric server. REQUIRED: specify which profile to use (e.g., "earth", "default"). Call list_profiles first if unsure.',
    inputSchema: z.object({
      profile: z.string().describe('Config profile name (REQUIRED - e.g., "earth", "default")'),
    }),
  },
  fabric_disconnect: {
    description: 'Disconnect from the Fabric server',
    inputSchema: z.object({}),
  },
  fabric_status: {
    description: 'Get current connection state and scene info',
    inputSchema: z.object({}),
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

export async function handleFabricConnect(
  client: MVFabricClient,
  args: { profile: string }
): Promise<string> {
  const profile = await getProfile(args.profile);
  await client.connect(profile.fabricUrl, profile.adminKey || '');
  return JSON.stringify({
    success: true,
    profile: args.profile,
    fabricUrl: profile.fabricUrl,
  });
}

export async function handleFabricDisconnect(client: MVFabricClient): Promise<string> {
  await client.disconnect();
  return JSON.stringify({ success: true });
}

export function handleFabricStatus(client: MVFabricClient): string {
  return JSON.stringify(client.getStatus());
}
