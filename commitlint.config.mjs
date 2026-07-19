/**
 * Conventional Commits, enforced. Scopes = module names + core areas
 * (see .agent/rules/git.md).
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        // feature modules
        'file-transfer',
        'previews',
        'clipboard',
        'themes',
        'heimdall',
        'qr-tool',
        'presence',
        'audit-log',
        'runestone',
        // core areas
        'core',
        'client',
        'ci',
        'docs',
        'chore',
        // release commits (manual now, PLAN-09 automation later)
        'release',
      ],
    ],
    'subject-case': [2, 'always', 'lower-case'],
    'header-max-length': [2, 'always', 72],
  },
};
