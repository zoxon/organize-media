import antfu from '@antfu/eslint-config'

export default antfu({
  node: true,
  typescript: true,
  type: 'app',
  ignores: ['no-date-report/', 'CLAUDE.md'],
})
