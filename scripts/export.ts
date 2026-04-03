import { loadFullGraph, initSchema, closePool } from '../src/lib/db.js';
import { writeFileSync } from 'fs';

await initSchema();
const g = await loadFullGraph();
writeFileSync('graph.json', JSON.stringify(g, null, 2));
console.log(`Exported ${Object.keys(g.nodes).length} nodes, ${Object.keys(g.edges).length} edges → graph.json`);
await closePool();
