module.exports = {
  root:    true,
  extends: '@react-native',
  rules: {
    'react-native/no-inline-styles': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
}
