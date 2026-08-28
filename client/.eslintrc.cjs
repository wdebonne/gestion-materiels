/**
 * Configuration ESLint.
 *
 * Les plugins étaient dans les devDependencies et le script `lint` dans
 * package.json, mais aucun fichier de configuration n'existait : la commande
 * échouait immédiatement, donc personne ne lintait.
 */
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.cjs', 'vite.config.ts'],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

    // 440 occurrences aujourd'hui. En faire une erreur rendrait `npm run lint`
    // impossible à passer, donc jamais lancé — le même résultat qu'aujourd'hui.
    // Le typage est traité à part ; la règle reste visible en avertissement.
    '@typescript-eslint/no-explicit-any': 'warn',

    // Reste bloquant : c'est du code mort, et c'est ce qui fait douter d'un
    // fichier quand on le relit. Le préfixe `_` marque ce qui est gardé
    // volontairement — une intention non branchée, pas un oubli.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
};
