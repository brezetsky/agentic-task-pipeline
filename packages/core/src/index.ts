/**
 * Package barrel. May reference env-reading helpers, so it must NOT be imported
 * by workflow code — workflows import "@pipeline/core/contracts" directly.
 */
export * from './contracts/index.js';
export * from './config.js';
export * from './providers/index.js';

export * from './policy.js';
export * from './context.js';
