/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileConfig } from '../config.js';
import type { FileStorage } from './FileStorage.js';
import { ScpStorage } from './ScpStorage.js';
import { WebDavStorage } from './WebDavStorage.js';

/**
 * Select the resource-file transport for a profile: a configured `filesUrl`
 * routes file operations over WebDAV; otherwise the SCP/SSH transport is used.
 */
export function createFileStorage(profile: ProfileConfig): FileStorage {
  return profile.filesUrl ? new WebDavStorage(profile) : new ScpStorage(profile);
}
