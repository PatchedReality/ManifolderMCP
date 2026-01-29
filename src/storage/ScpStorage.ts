import SftpClient from 'ssh2-sftp-client';
import { readFile } from 'fs/promises';
import { basename, join } from 'path';
import { expandPath, type ProfileConfig } from '../config.js';

export interface UploadResult {
  url: string;
  filename: string;
}

export interface ResourceInfo {
  name: string;
  url: string;
  size: number;
  lastModified: Date;
}

export class ScpStorage {
  private config: ProfileConfig;

  constructor(config: ProfileConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return !!(this.config.scpHost && this.config.scpUser && this.config.scpKeyPath && this.config.scpRemotePath && this.config.resourceUrlPrefix);
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error('Storage not configured. Add scpHost, scpUser, scpKeyPath, scpRemotePath, and resourceUrlPrefix to your profile.');
    }
  }

  private async connect(): Promise<SftpClient> {
    this.ensureConfigured();
    const sftp = new SftpClient();
    const keyPath = expandPath(this.config.scpKeyPath!);
    const privateKey = await readFile(keyPath, 'utf-8');

    await sftp.connect({
      host: this.config.scpHost!,
      username: this.config.scpUser!,
      privateKey,
    });

    return sftp;
  }

  private async getRemotePath(sftp: SftpClient): Promise<string> {
    let remotePath = this.config.scpRemotePath!;
    if (remotePath.startsWith('~/')) {
      const cwd = await sftp.cwd();
      remotePath = remotePath.replace('~', cwd);
    }
    return remotePath;
  }

  async upload(localPath: string, targetName?: string): Promise<UploadResult> {
    const filename = targetName || basename(localPath);
    const sftp = await this.connect();

    try {
      const baseRemotePath = await this.getRemotePath(sftp);
      const remotePath = join(baseRemotePath, filename);
      await sftp.put(localPath, remotePath);
      return {
        url: this.config.resourceUrlPrefix! + filename,
        filename,
      };
    } finally {
      await sftp.end();
    }
  }

  async list(filter?: string): Promise<ResourceInfo[]> {
    const sftp = await this.connect();

    try {
      const remotePath = await this.getRemotePath(sftp);
      const files = await sftp.list(remotePath);
      let results = files.filter(f => f.type === '-');

      if (filter) {
        const pattern = new RegExp(filter.replace(/\*/g, '.*'), 'i');
        results = results.filter(f => pattern.test(f.name));
      }

      return results.map(f => ({
        name: f.name,
        url: this.config.resourceUrlPrefix! + f.name,
        size: f.size,
        lastModified: new Date(f.modifyTime),
      }));
    } finally {
      await sftp.end();
    }
  }

  async delete(resourceName: string): Promise<void> {
    const sftp = await this.connect();

    try {
      const baseRemotePath = await this.getRemotePath(sftp);
      const remotePath = join(baseRemotePath, resourceName);
      await sftp.delete(remotePath);
    } finally {
      await sftp.end();
    }
  }

  getBaseUrl(): string {
    this.ensureConfigured();
    return this.config.resourceUrlPrefix!;
  }
}
