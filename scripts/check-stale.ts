/**
 * CI-friendly staleness check.
 * Exits 1 if any nodes are stale or unassessed.
 *
 * Usage: npx tsx scripts/check-stale.ts [workspace-root] [--json] [--limit N]
 *
 * Example GitHub Actions step:
 *   - run: npx tsx scripts/check-stale.ts --json > stale.json
 */
import { Store } from '../src/lib/store.js';
import { walkTree } from '../src/lib/filetree.js';
import { getHeadCommit } from '../src/lib/git.js';

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? '50', 10) : 50;
const workspaceRoot = args.find((a) => !a.startsWith('--') && args.indexOf(a) !== limitIdx + 1)
  ?? process.env['ZYGOMORPHIC_WORKSPACE']
  ?? process.cwd();

const store = new Store(workspaceRoot);
const paths = walkTree(workspaceRoot);
store.rebuildIndex(paths);

const head = getHeadCommit(workspaceRoot);
const stale = store.getStale(head, limit);

if (jsonMode) {
  console.log(JSON.stringify({ head_commit: head, stale_count: stale.length, nodes: stale }, null, 2));
} else {
  if (stale.length === 0) {
    console.log(`All nodes current${head ? ` @ ${head.slice(0, 7)}` : ''}`);
  } else {
    console.log(`${stale.length} stale node(s)${head ? ` (HEAD: ${head.slice(0, 7)})` : ''}:\n`);
    for (const n of stale) {
      const reason = !n.assessed_at_commit ? 'never assessed' : `last @ ${n.assessed_at_commit.slice(0, 7)}`;
      console.log(`  ${n.id}  (${reason})`);
    }
  }
}

process.exit(stale.length > 0 ? 1 : 0);
