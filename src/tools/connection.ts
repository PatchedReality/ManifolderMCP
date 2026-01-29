import { z } from 'zod';
import type { MVFabricClient } from '../client/MVFabricClient.js';
import { getProfile } from '../config.js';

export const connectionTools = {
  fabric_connect: {
    description: 'Connect to a Fabric server using a config profile',
    inputSchema: z.object({
      profile: z.string().optional().describe('Config profile name (default: "default")'),
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

export async function handleFabricConnect(
  client: MVFabricClient,
  args: { profile?: string }
): Promise<string> {
  const profileName = args.profile ?? 'default';
  const profile = await getProfile(profileName);

  await client.connect(profile.fabricUrl, profile.adminKey || '');

  return JSON.stringify({
    success: true,
    profile: profileName,
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
