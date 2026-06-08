/**
 * Signal & query DEFINITIONS, kept in their own module (no `proxyActivities`).
 * `defineSignal`/`defineQuery` only build definition objects and do not require
 * a workflow context, so this module is safe to import from the API/CLI to send
 * signals and run queries with full type-safety.
 */
import { defineQuery, defineSignal } from '@temporalio/workflow';
import type { Decision, RunStatus } from '@pipeline/core/contracts';

/** Human decision delivered to a paused run. */
export const submitDecision = defineSignal<[Decision]>('submitDecision');

/** Live snapshot of a run (drives the API/UI status view). */
export const getStatus = defineQuery<RunStatus>('getStatus');
