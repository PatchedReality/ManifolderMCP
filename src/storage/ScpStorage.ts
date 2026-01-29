import SftpClient from 'ssh2-sftp-client';
import { readFile, mkdir } from 'fs/promises';
import { basename, dirname, join } from 'path';
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

  private validateResourcePath(basePath: string, resourceName: string): string {
    const resolved = join(basePath, resourceName);
    const normalizedBase = basePath.endsWith('/') ? basePath : basePath + '/';
    if (!resolved.startsWith(normalizedBase)) {
      throw new Error(`Invalid resource path: "${resourceName}" escapes resource directory`);
    }
    return resolved;
  }

  private async ensureRemoteDir(sftp: SftpClient, remotePath: string, basePath: string): Promise<void> {
    const remoteDir = dirname(remotePath);
    if (remoteDir !== basePath) {
      await sftp.mkdir(remoteDir, true);
    }
  }

  private async ensureLocalDir(localPath: string): Promise<void> {
    await mkdir(dirname(localPath), { recursive: true });
  }

  async upload(localPath: string, targetName?: string): Promise<UploadResult> {
    const filename = targetName || basename(localPath);
    const sftp = await this.connect();

    try {
      const baseRemotePath = await this.getRemotePath(sftp);
      const remotePath = join(baseRemotePath, filename);

      await this.ensureRemoteDir(sftp, remotePath, baseRemotePath);
      await sftp.put(localPath, remotePath);
      return {
        url: this.config.resourceUrlPrefix! + filename,
        filename,
      };
    } finally {
      await sftp.end();
    }
  }

  async list(path?: string, filter?: string, recursive?: boolean): Promise<ResourceInfo[]> {
    const sftp = await this.connect();

    try {
      const basePath = await this.getRemotePath(sftp);
      const targetPath = path ? join(basePath, path) : basePath;

      const results: ResourceInfo[] = [];
      const prefix = path ? path + '/' : '';

      const listDir = async (dirPath: string, relativePrefix: string) => {
        const files = await sftp.list(dirPath);

        for (const f of files) {
          if (f.type === '-') {
            const name = relativePrefix + f.name;
            results.push({
              name,
              url: this.config.resourceUrlPrefix! + name,
              size: f.size,
              lastModified: new Date(f.modifyTime),
            });
          } else if (f.type === 'd' && recursive && f.name !== '.' && f.name !== '..') {
            await listDir(join(dirPath, f.name), relativePrefix + f.name + '/');
          }
        }
      };

      await listDir(targetPath, prefix);

      if (filter) {
        const escaped = filter.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$', 'i');
        return results.filter(r => pattern.test(basename(r.name)));
      }

      return results;
    } finally {
      await sftp.end();
    }
  }

  async delete(resourceName: string): Promise<void> {
    const sftp = await this.connect();

    try {
      const baseRemotePath = await this.getRemotePath(sftp);
      const remotePath = this.validateResourcePath(baseRemotePath, resourceName);

      const exists = await sftp.exists(remotePath);
      if (!exists) {
        throw new Error(`Resource not found: "${resourceName}"`);
      }
      if (exists === 'd') {
        throw new Error(`Cannot delete directory: "${resourceName}" - only files can be deleted`);
      }

      await sftp.delete(remotePath);
    } finally {
      await sftp.end();
    }
  }

  async move(sourceName: string, destName: string): Promise<{ url: string; filename: string }> {
    const sftp = await this.connect();

    try {
      const baseRemotePath = await this.getRemotePath(sftp);
      const sourcePath = this.validateResourcePath(baseRemotePath, sourceName);
      const destPath = this.validateResourcePath(baseRemotePath, destName);

      const exists = await sftp.exists(sourcePath);
      if (!exists) {
        throw new Error(`Source resource not found: "${sourceName}"`);
      }
      if (exists === 'd') {
        throw new Error(`Cannot move directory: "${sourceName}" - only files can be moved`);
      }

      await this.ensureRemoteDir(sftp, destPath, baseRemotePath);
      await sftp.rename(sourcePath, destPath);
      return {
        url: this.config.resourceUrlPrefix! + destName,
        filename: destName,
      };
    } finally {
      await sftp.end();
    }
  }

  getBaseUrl(): string {
    this.ensureConfigured();
    return this.config.resourceUrlPrefix!;
  }

  async bulkUpload(files: Array<{ localPath: string; targetName?: string }>): Promise<{
    success: UploadResult[];
    failed: Array<{ path: string; error: string }>;
  }> {
    const sftp = await this.connect();
    const success: UploadResult[] = [];
    const failed: Array<{ path: string; error: string }> = [];

    try {
      const baseRemotePath = await this.getRemotePath(sftp);

      for (const file of files) {
        try {
          const filename = file.targetName || basename(file.localPath);
          const remotePath = join(baseRemotePath, filename);

          await this.ensureRemoteDir(sftp, remotePath, baseRemotePath);
          await sftp.put(file.localPath, remotePath);
          success.push({
            url: this.config.resourceUrlPrefix! + filename,
            filename,
          });
        } catch (err) {
          failed.push({ path: file.localPath, error: (err as Error).message });
        }
      }
    } finally {
      await sftp.end();
    }

    return { success, failed };
  }

  async bulkDelete(resourceNames: string[]): Promise<{
    deleted: string[];
    failed: Array<{ name: string; error: string }>;
    skipped: Array<{ name: string; reason: string }>;
  }> {
    const sftp = await this.connect();
    const deleted: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    try {
      const baseRemotePath = await this.getRemotePath(sftp);

      // Phase 1: Validate all paths and check existence
      const validated: Array<{ name: string; remotePath: string }> = [];

      for (const name of resourceNames) {
        try {
          const remotePath = this.validateResourcePath(baseRemotePath, name);
          const exists = await sftp.exists(remotePath);

          if (!exists) {
            skipped.push({ name, reason: 'File not found' });
          } else if (exists === 'd') {
            skipped.push({ name, reason: 'Is a directory, not a file' });
          } else {
            validated.push({ name, remotePath });
          }
        } catch (err) {
          failed.push({ name, error: (err as Error).message });
        }
      }

      // Phase 2: Delete only validated files
      for (const { name, remotePath } of validated) {
        try {
          await sftp.delete(remotePath);
          deleted.push(name);
        } catch (err) {
          failed.push({ name, error: (err as Error).message });
        }
      }
    } finally {
      await sftp.end();
    }

    return { deleted, failed, skipped };
  }

  async bulkMove(moves: Array<{ sourceName: string; destName: string }>): Promise<{
    moved: Array<{ sourceName: string; url: string; filename: string }>;
    failed: Array<{ sourceName: string; destName: string; error: string }>;
    skipped: Array<{ sourceName: string; destName: string; reason: string }>;
  }> {
    const sftp = await this.connect();
    const moved: Array<{ sourceName: string; url: string; filename: string }> = [];
    const failed: Array<{ sourceName: string; destName: string; error: string }> = [];
    const skipped: Array<{ sourceName: string; destName: string; reason: string }> = [];

    try {
      const baseRemotePath = await this.getRemotePath(sftp);

      // Phase 1: Validate all paths and check existence
      const validated: Array<{ sourceName: string; destName: string; sourcePath: string; destPath: string }> = [];

      for (const move of moves) {
        try {
          const sourcePath = this.validateResourcePath(baseRemotePath, move.sourceName);
          const destPath = this.validateResourcePath(baseRemotePath, move.destName);
          const exists = await sftp.exists(sourcePath);

          if (!exists) {
            skipped.push({ sourceName: move.sourceName, destName: move.destName, reason: 'Source file not found' });
          } else if (exists === 'd') {
            skipped.push({ sourceName: move.sourceName, destName: move.destName, reason: 'Source is a directory, not a file' });
          } else {
            validated.push({ sourceName: move.sourceName, destName: move.destName, sourcePath, destPath });
          }
        } catch (err) {
          failed.push({
            sourceName: move.sourceName,
            destName: move.destName,
            error: (err as Error).message,
          });
        }
      }

      // Phase 2: Move only validated files
      for (const { sourceName, destName, sourcePath, destPath } of validated) {
        try {
          await this.ensureRemoteDir(sftp, destPath, baseRemotePath);
          await sftp.rename(sourcePath, destPath);
          moved.push({
            sourceName,
            url: this.config.resourceUrlPrefix! + destName,
            filename: destName,
          });
        } catch (err) {
          failed.push({
            sourceName,
            destName,
            error: (err as Error).message,
          });
        }
      }
    } finally {
      await sftp.end();
    }

    return { moved, failed, skipped };
  }

  async download(resourceName: string, localPath: string): Promise<{ resourceName: string; localPath: string }> {
    const sftp = await this.connect();

    try {
      const baseRemotePath = await this.getRemotePath(sftp);
      const remotePath = join(baseRemotePath, resourceName);

      await this.ensureLocalDir(localPath);
      await sftp.get(remotePath, localPath);
      return { resourceName, localPath };
    } finally {
      await sftp.end();
    }
  }

  async bulkDownload(downloads: Array<{ resourceName: string; localPath: string }>): Promise<{
    success: Array<{ resourceName: string; localPath: string }>;
    failed: Array<{ resourceName: string; localPath: string; error: string }>;
  }> {
    const sftp = await this.connect();
    const success: Array<{ resourceName: string; localPath: string }> = [];
    const failed: Array<{ resourceName: string; localPath: string; error: string }> = [];

    try {
      const baseRemotePath = await this.getRemotePath(sftp);

      for (const dl of downloads) {
        try {
          const remotePath = join(baseRemotePath, dl.resourceName);

          await this.ensureLocalDir(dl.localPath);
          await sftp.get(remotePath, dl.localPath);
          success.push({ resourceName: dl.resourceName, localPath: dl.localPath });
        } catch (err) {
          failed.push({
            resourceName: dl.resourceName,
            localPath: dl.localPath,
            error: (err as Error).message,
          });
        }
      }
    } finally {
      await sftp.end();
    }

    return { success, failed };
  }
}
