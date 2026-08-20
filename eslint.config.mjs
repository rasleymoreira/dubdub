import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Regra da dependencia da Clean Architecture, aplicada pelo linter.
 *
 * As setas apontam so para dentro: domain <- application <- infrastructure
 * <- presentation. Sem isso a arquitetura apodrece em silencio, porque nada
 * impede um import "so dessa vez" de dentro para fora.
 */
function forbidLayers(layers, motivo) {
  const patterns = layers.flatMap((layer) => [
    { group: [`@${layer}/*`], message: motivo },
    { group: [`**/${layer}/**`], message: motivo }
  ]);
  return { 'no-restricted-imports': ['error', { patterns }] };
}

export default tseslint.config(
  {
    ignores: [
      'build/**',
      'node_modules/**',
      'models/**',
      'samples/**',
      'icons/**',
      // ambientes Python dos servidores de TTS local
      '.venv/**',
      '.venv-kokoro/**',
      '.venv-f5/**',
      // tools/ e codigo standalone (host de native messaging, servidores Python)
      // que roda fora do bundle e nao segue as regras de camada
      'tools/**',
      // codigo legado em JavaScript, removido ao fim da migracao
      'src/background/**',
      'src/content/**',
      'src/popup/**',
      'src/shared/constants.js',
      'tests/*.js'
    ]
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error'
    }
  },

  {
    files: ['src/domain/**/*.ts'],
    rules: forbidLayers(
      ['application', 'infrastructure', 'presentation'],
      'domain nao pode depender de camadas externas: e a camada mais interna, feita de regras puras.'
    )
  },

  {
    files: ['src/application/**/*.ts'],
    rules: forbidLayers(
      ['infrastructure', 'presentation'],
      'application so pode depender de domain. Para falar com o mundo, declare uma porta em application/ports e injete o adapter no composition root.'
    )
  },

  {
    files: ['src/infrastructure/**/*.ts'],
    rules: forbidLayers(
      ['presentation'],
      'infrastructure nao pode depender de presentation: quem monta as duas e o composition root.'
    )
  },

  {
    files: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
    languageOptions: {
      globals: {}
    },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'chrome.* e detalhe de plataforma: use uma porta.' },
        { name: 'fetch', message: 'fetch e detalhe de infraestrutura: use uma porta.' },
        { name: 'document', message: 'DOM e detalhe de apresentacao: use uma porta.' },
        { name: 'window', message: 'DOM e detalhe de apresentacao: use uma porta.' },
        {
          name: 'indexedDB',
          message: 'IndexedDB e detalhe de infraestrutura: use um repositorio.'
        },
        {
          name: 'localStorage',
          message: 'Armazenamento e detalhe de infraestrutura: use uma porta.'
        }
      ]
    }
  },

  {
    // o unico lugar autorizado a falar com o console e o adapter de log
    files: ['src/infrastructure/logging/**/*.ts'],
    rules: { 'no-console': 'off' }
  },

  {
    files: ['tests/**/*.ts', 'tests/**/*.mjs', 'scripts/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly'
      }
    },
    rules: {
      'no-console': 'off',
      'no-restricted-imports': 'off'
    }
  }
);
