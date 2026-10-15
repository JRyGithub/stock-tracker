import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.output/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // House style: arrow functions only (see AGENTS.md). Class/object methods and generators are exempt
    // because they can't be arrows.
    rules: {
      'prefer-arrow-callback': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'FunctionDeclaration[generator=false]',
          message: 'Use an arrow function: `const name = (...) => { ... }`.',
        },
        {
          selector:
            'FunctionExpression[generator=false]:not(MethodDefinition > FunctionExpression):not(Property[method=true] > FunctionExpression)',
          message: 'Use an arrow function instead of `function () {}`.',
        },
      ],
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
