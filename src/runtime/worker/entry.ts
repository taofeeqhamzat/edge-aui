/**
 * Worker entry point
 *
 * This module exists solely so the worker has a top-level entry that Vite can statically
 * analyse and bundle. Constructing the worker here — with the URL literal inline — is what
 * makes `new Worker(new URL('./entry.ts', import.meta.url), { type: 'module' })` resolvable
 * at build time.
 *
 * Without this, the worker was emitted as raw TypeScript source in the production bundle and
 * could not execute.
 */

import { RuntimeWorkerCore } from './core';
import type { RuntimeWorkerRequest } from '../messages';

const core = new RuntimeWorkerCore();

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.addEventListener('message', async (event: MessageEvent<RuntimeWorkerRequest>) => {
    const response = await core.handleRequest(event.data);
    self.postMessage(response);
  });
}
