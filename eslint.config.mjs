import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['packages/worker/src/workflows/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@pipeline/core', message: 'Use the pure contracts subpath in workflows.' },
          ],
          patterns: [
            {
              group: ['node:*', 'fs', 'path'],
              message:
                'Workflows import only the pure contracts subpath; all I/O belongs in activities.',
            },
            {
              group: ['../activities/*'],
              allowTypeImports: true,
              message: 'Only type imports may cross the activity boundary.',
            },
          ],
        },
      ],
    },
  },
);
