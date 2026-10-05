/**
 * Signal & query DEFINITIONS, kept in their own module (no `proxyActivities`).
 * Names come from shared constants in @pipeline/core/contracts so the worker
 * and the API/CLI can never drift. `defineSignal`/`defineQuery` don't require a
 * workflow context, so this is safe to import from the CLI for type-safe calls.
 */
import { defineQuery, defineSignal } from '@temporalio/workflow';
import { QUERY_GET_STATUS, SIGNAL_SUBMIT_DECISION } from '@pipeline/core/contracts';
import type { Decision, RunStatus } from '@pipeline/core/contracts';

/** Human decision delivered to a paused run. */
export const submitDecision = defineSignal<[Decision]>(SIGNAL_SUBMIT_DECISION);

/** Live snapshot of a run (drives the API/UI status view). */
export const getStatus = defineQuery<RunStatus>(QUERY_GET_STATUS);
