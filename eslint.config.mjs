import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['.pnpmfile.cjs', 'out/**', 'dist/**', 'node_modules/**', 'src/renderer/**', 'tests/fixtures/**', 'scripts/e2e/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Extensión de Chrome: JavaScript de navegador (service worker y ventana emergente), sin empaquetador.
    files: ['extension/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: Object.fromEntries(
        ['chrome', 'navigator', 'document', 'WebSocket', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'globalThis', 'self', 'console', 'URL'].map((g) => [g, 'readonly'])
      )
    }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  }
)
