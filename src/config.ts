import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

export interface ProfileConfig {
  fabricUrl: string;
  adminKey?: string;  // Optional for anonymous/read-only access
  // SCP/SSH storage settings (optional for read-only profiles)
  scpHost?: string;
  scpUser?: string;
  scpRemotePath?: string;
  scpKeyPath?: string;
  // URL prefix for referencing uploaded resources in scenes (e.g. "/objects/")
  resourceUrlPrefix?: string;
}

export interface FabricMCPConfig {
  [profileName: string]: ProfileConfig;
}

const CONFIG_PATH = join(homedir(), '.config', 'fabric-mcp', 'config.json');

let cachedConfig: FabricMCPConfig | null = null;

export async function loadConfig(): Promise<FabricMCPConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const content = await readFile(CONFIG_PATH, 'utf-8');
    cachedConfig = JSON.parse(content) as FabricMCPConfig;
    return cachedConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Config file not found at ${CONFIG_PATH}. Please create it with your Fabric connection settings.`);
    }
    throw new Error(`Failed to load config: ${(error as Error).message}`);
  }
}

export async function getProfile(profileName: string = 'default'): Promise<ProfileConfig> {
  const config = await loadConfig();
  const profile = config[profileName];

  if (!profile) {
    const available = Object.keys(config).join(', ');
    throw new Error(`Profile "${profileName}" not found. Available profiles: ${available}`);
  }

  return profile;
}

export function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}
