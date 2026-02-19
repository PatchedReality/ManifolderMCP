import { z } from 'zod';
import type { IManifolderPromiseClient } from '../client/ManifolderClient.js';
import { getProfile, loadConfig } from '../config.js';

export const connectionTools = {
  list_profiles: {
    description: 'List available Fabric connection profiles from config',
    inputSchema: z.object({}),
  },
  fabric_connect: {
    description: 'Connect to a Fabric server. REQUIRED: specify which profile to use (e.g., "earth", "default"). Call list_profiles first if unsure. Alternatively, provide a direct url for anonymous connection.',
    inputSchema: z.object({
      profile: z.string().optional().describe('Config profile name (e.g., "earth", "default")'),
      url: z.string().optional().describe('Direct fabric URL for anonymous connection'),
    }).refine(
      data => (data.profile != null) !== (data.url != null),
      { message: 'Provide either profile or url, not both' }
    ),
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

const CONNECT_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

export async function handleFabricConnect(
  client: IManifolderPromiseClient,
  args: { profile?: string; url?: string }
): Promise<string> {
  const status = client.getStatus();
  if (status.connected) {
    await client.disconnect();
  }

  let fabricUrl: string;
  let adminKey: string;
  if (args.url) {
    fabricUrl = args.url;
    adminKey = '';
  } else {
    const profile = await getProfile(args.profile!);
    fabricUrl = profile.fabricUrl;
    adminKey = profile.adminKey || '';
  }

  await withTimeout(
    client.connect(fabricUrl, adminKey),
    CONNECT_TIMEOUT_MS,
    `Connection to ${fabricUrl} timed out after ${CONNECT_TIMEOUT_MS / 1000}s`
  );

  return JSON.stringify({
    success: true,
    profile: args.url ? 'anonymous' : args.profile,
    fabricUrl,
  });
}

export async function handleFabricDisconnect(client: IManifolderPromiseClient): Promise<string> {
  await client.disconnect();
  return JSON.stringify({ success: true });
}

export function handleFabricStatus(client: IManifolderPromiseClient): string {
  return JSON.stringify(client.getStatus());
}
