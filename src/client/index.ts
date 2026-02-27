/*
 * Copyright 2026 Patched Reality, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import '../../lib/ManifolderClient/node/mv-loader.js';

export {
  SingleScopeClient,
  ManifolderClient,
  createManifolderSubscriptionClient,
  createManifolderPromiseClient,
  asManifolderSubscriptionClient,
  asManifolderPromiseClient,
  normalizeUrl,
  computeScopeId,
  computeRootScopeId,
  computeChildScopeId,
  computeNodeUid,
} from '../../lib/ManifolderClient/ManifolderClient.js';

export type {
  IManifolderClientCommon,
  IManifolderSubscriptionClient,
  IManifolderPromiseClient,
} from '../../lib/ManifolderClient/ManifolderClient.js';
