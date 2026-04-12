/**
 * Init command: create .zygomorphic/ mirror for a workspace.
 * Usage: npx tsx scripts/init.ts [workspace-root]
 */
import { Store } from '../src/lib/store.js';
import { walkTree, ensureMirror } from '../src/lib/filetree.js';

const workspaceRoot = process.argv[2] ?? process.cwd();
const paths = walkTree(workspaceRoot);

console.log(`Workspace: ${workspaceRoot}`);
console.log(`Found ${paths.length} paths`);

ensureMirror(workspaceRoot, paths);

const store = new Store(workspaceRoot);
store.rebuildIndex(paths);

const tree = store.getTree();
console.log(`Initialized ${Object.keys(tree.nodes).length} nodes in .zygomorphic/`);
