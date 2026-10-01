import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, it } from 'vitest';

it('negotiates real MCP stdio, retrieves grounded context and rejects unsafe reads/plans', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('packages/mcp/dist/server.js')],
    env: { MCP_REPO_ROOT: resolve('sandbox') },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'contract-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      'read_context_file',
      'review_plan',
      'search_repository',
    ]);
    expect(tools.tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    const result = await client.callTool({
      name: 'search_repository',
      arguments: { query: 'sum' },
    });
    expect(JSON.stringify(result)).toContain('src/sum.js');
    const denied = await client.callTool({
      name: 'read_context_file',
      arguments: { path: '../.env' },
    });
    expect(denied.isError).toBe(true);
    const policy = await client.readResource({ uri: 'pipeline://policy' });
    expect(policy.contents[0]).toHaveProperty('text');
    const reviewed = await client.callTool({
      name: 'review_plan',
      arguments: {
        plan: {
          summary: 'Unsafe',
          steps: ['Escape'],
          edits: [{ path: '../escape', action: 'create', contents: 'x' }],
          testCommand: 'npm test',
        },
      },
    });
    expect(JSON.stringify(reviewed)).toContain('false');
    expect((await client.listPrompts()).prompts[0].name).toBe('review-task');
    await expect(client.callTool({ name: 'approve_run', arguments: {} })).rejects.toThrow();
  } finally {
    await client.close();
    await transport.close();
  }
});
