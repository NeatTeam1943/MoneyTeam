import { build } from 'esbuild'
const S = '/tmp/claude-0/-home-claude/f187f6c9-9035-562a-81a0-31a942398c27/scratchpad'
await build({
  entryPoints: [S + '/modal-harness.jsx'], bundle: true, jsx: 'automatic',
  outfile: S + '/modal-harness.js', loader: { '.jsx': 'jsx' },
  nodePaths: ['/home/claude/MoneyTeam/node_modules'],
  define: { 'process.env.NODE_ENV': '"development"' },
})
