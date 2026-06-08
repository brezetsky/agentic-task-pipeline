/**
 * LLM provider: Google Gemini via the Vercel AI SDK (`ai` + `@ai-sdk/google`),
 * using `generateObject` with our zod contracts for reliable structured output.
 * Falls back to a deterministic stub when no API key is configured.
 */
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { AppConfig } from '../config.js';
import { AnalysisSchema, PlanSchema } from '../contracts/index.js';
import type { Analysis, Plan, Task } from '../contracts/index.js';
import type { LlmProvider, PlanArgs } from './types.js';

/** Deterministic, dependency-free fallback used when GEMINI is not configured. */
export class StubLlmProvider implements LlmProvider {
  readonly name = 'stub';

  async analyze(task: Task): Promise<Analysis> {
    return {
      summary: `Reviewed "${task.title}". ${task.description}`.slice(0, 500),
      affectedAreas: ['README.md', 'src/'],
      risks: ['Stub analysis — set GOOGLE_GENERATIVE_AI_API_KEY for real LLM reasoning.'],
    };
  }

  async plan({ task, feedback }: PlanArgs): Promise<Plan> {
    return {
      summary: `Plan to implement "${task.title}".${feedback ? ` Revised to address: ${feedback}` : ''}`,
      steps: [
        'Inspect the affected area of the target repository',
        `Apply a focused change addressing: ${task.title}`,
        'Run the test suite and confirm it passes',
      ],
      edits: [
        {
          path: 'CHANGES.md',
          action: 'create',
          contents: `# ${task.title}\n\n${task.description}\n${feedback ? `\n> Revision: ${feedback}\n` : ''}`,
          rationale: 'Document the change (stub edit).',
        },
      ],
      testCommand: 'npm test',
    };
  }
}

/** Real provider backed by Google Gemini. */
export class GeminiLlmProvider implements LlmProvider {
  readonly name = 'gemini';

  constructor(private readonly cfg: AppConfig['llm']) {}

  private model() {
    const google = createGoogleGenerativeAI(this.cfg.apiKey ? { apiKey: this.cfg.apiKey } : {});
    return google(this.cfg.model);
  }

  async analyze(task: Task): Promise<Analysis> {
    const { object } = await generateObject({
      model: this.model(),
      schema: AnalysisSchema,
      temperature: 0,
      maxRetries: 1,
      prompt: [
        'You are a senior engineer analyzing a software task before implementation.',
        `Task title: ${task.title}`,
        `Task description: ${task.description}`,
        '',
        'Produce a concise technical analysis: a one-paragraph summary of what the task',
        'requires, the areas/files likely affected, and the key risks or unknowns.',
      ].join('\n'),
    });
    return object;
  }

  async plan({ task, analysis, feedback }: PlanArgs): Promise<Plan> {
    const { object } = await generateObject({
      model: this.model(),
      schema: PlanSchema,
      temperature: 0,
      maxRetries: 1,
      prompt: [
        'You are a senior engineer proposing an implementation plan for a software task.',
        'A human will review and either approve or request changes.',
        '',
        `Task: ${task.title}`,
        `Description: ${task.description}`,
        `Analysis: ${analysis.summary}`,
        `Likely affected areas: ${analysis.affectedAreas.join(', ')}`,
        feedback
          ? `\nThe human requested changes to your previous plan. Incorporate this feedback: "${feedback}"`
          : '',
        '',
        'Return a plan with:',
        '- summary: one paragraph describing the approach',
        '- steps: an ordered list of concrete implementation steps',
        '- edits: the actual file changes. For each: repo-relative path, action',
        '  (create|update|delete), and for create/update the FULL new file contents.',
        '  Keep changes minimal and focused. The target is a small Node.js project.',
        '- testCommand: the shell command to run the tests (default "npm test")',
      ].join('\n'),
    });
    return object;
  }
}

export function createLlmProvider(cfg: AppConfig): LlmProvider {
  return cfg.llm.enabled ? new GeminiLlmProvider(cfg.llm) : new StubLlmProvider();
}
