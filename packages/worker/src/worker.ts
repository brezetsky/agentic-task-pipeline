import { resolve } from 'node:path';
import { NativeConnection, Worker } from '@temporalio/worker';
import { loadConfig, loadEnv } from '@pipeline/core';
import * as activities from './activities/index.js';

async function connectWithRetry(address: string, attempts = 60): Promise<NativeConnection> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await NativeConnection.connect({ address });
    } catch (err) {
      lastErr = err;
      console.log(`[worker] waiting for Temporal at ${address} (attempt ${i}/${attempts})...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  process.chdir(resolve(__dirname, '../../..'));
  loadEnv();
  const cfg = loadConfig();
  const connection = await connectWithRetry(cfg.temporal.address);
  const worker = await Worker.create({
    connection,
    namespace: cfg.temporal.namespace,
    taskQueue: cfg.temporal.taskQueue,
    workflowsPath: require.resolve('./workflows/index'),
    activities,
  });
  console.log(
    `[worker] ready — namespace=${cfg.temporal.namespace} taskQueue=${cfg.temporal.taskQueue} (Temporal ${cfg.temporal.address})`,
  );
  await worker.run();
}

main().catch((err) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});
