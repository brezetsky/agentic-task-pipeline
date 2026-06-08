import type { StartRunInput } from '@pipeline/core/contracts';

/**
 * Temporal worker entrypoint. The deterministic workflow + the I/O activities
 * are wired up in Phase 1. For now this validates the toolchain and the
 * deterministic-safe deep import of "@pipeline/core/contracts".
 */
async function main(): Promise<void> {
  console.log('[worker] scaffold ready — workflows/activities arrive in Phase 1');
}

/** Re-export proves the contracts deep-import resolves at build time. */
export type WorkerStartInput = StartRunInput;

main().catch((err) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});
