import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  getPool, initSchema, closePool,
  loadFullGraph, getNode, insertNode, updateNode, deleteNode,
  insertEdge, deleteEdge,
  getComments, insertComment, deleteExpiredComments,
  searchNodes, getNeighborhood,
} from './db.js';
import type { NodeData, Edge, Comment } from './types.js';

const now = new Date().toISOString();

function makeNode(id: string, content = '', summary = ''): NodeData {
  return { id, content, summary, exploration: [], created_at: now, updated_at: now };
}

function makeEdge(id: string, a: string, b: string, label: string): Edge {
  return { id, a, b, label, created_at: now };
}

const TEST_SCHEMA = 'test_' + process.pid;

beforeAll(async () => {
  const db = getPool();
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA}`);
  await db.query(`SET search_path TO ${TEST_SCHEMA}`);
  // Set search_path for every new connection in the pool
  db.on('connect', (client: pg.PoolClient) => {
    client.query(`SET search_path TO ${TEST_SCHEMA}`);
  });
  await initSchema();
});

afterAll(async () => {
  const db = getPool();
  await db.query(`DROP SCHEMA ${TEST_SCHEMA} CASCADE`);
  await closePool();
});

describe('nodes', () => {
  it('inserts and retrieves a node', async () => {
    const node = makeNode('n1', 'hello world', 'greeting');
    await insertNode(node);
    const got = await getNode('n1');
    expect(got).not.toBeNull();
    expect(got!.content).toBe('hello world');
    expect(got!.summary).toBe('greeting');
  });

  it('updates a node', async () => {
    await updateNode('n1', 'updated content', 'updated summary');
    const got = await getNode('n1');
    expect(got!.content).toBe('updated content');
    expect(got!.summary).toBe('updated summary');
  });

  it('returns null for missing node', async () => {
    const got = await getNode('nonexistent');
    expect(got).toBeNull();
  });
});

describe('edges', () => {
  it('inserts and loads edges', async () => {
    await insertNode(makeNode('n2', 'second node', 'second'));
    await insertEdge(makeEdge('e1', 'n1', 'n2', 'related'));

    const graph = await loadFullGraph();
    expect(graph.edges['e1']).toBeDefined();
    expect(graph.edges['e1'].label).toBe('related');
  });

  it('deletes an edge', async () => {
    await deleteEdge('e1');
    const graph = await loadFullGraph();
    expect(graph.edges['e1']).toBeUndefined();
  });
});

describe('cascade delete', () => {
  it('deleting a node removes its edges and comments', async () => {
    await insertNode(makeNode('n3', 'temp', 'temp'));
    await insertEdge(makeEdge('e2', 'n1', 'n3', 'linked'));
    await insertComment({
      id: 'c_cascade', node_id: 'n3', content: 'note',
      author: 'human', created_at: now, expires_at: null, score: 0, deleted_at: null,
    });

    await deleteNode('n3');

    const graph = await loadFullGraph();
    expect(graph.nodes['n3']).toBeUndefined();
    expect(graph.edges['e2']).toBeUndefined();

    const comments = await getComments('n3');
    expect(comments).toHaveLength(0);
  });
});

describe('comments', () => {
  it('inserts and retrieves comments', async () => {
    const comment: Comment = {
      id: 'c1', node_id: 'n1', content: 'interesting',
      author: 'human', created_at: now, expires_at: null, score: 0, deleted_at: null,
    };
    await insertComment(comment);
    const got = await getComments('n1');
    expect(got).toHaveLength(1);
    expect(got[0].content).toBe('interesting');
  });

  it('filters expired comments', async () => {
    const expired: Comment = {
      id: 'c2', node_id: 'n1', content: 'old',
      author: 'agent', created_at: now,
      expires_at: new Date(Date.now() - 60_000).toISOString(), score: 0, deleted_at: null,
    };
    await insertComment(expired);

    const got = await getComments('n1');
    expect(got.find((c) => c.id === 'c2')).toBeUndefined();
  });

  it('deleteExpiredComments removes old comments', async () => {
    const count = await deleteExpiredComments();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

describe('search', () => {
  it('finds nodes by content', async () => {
    const results = await searchNodes('updated');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((n) => n.id === 'n1')).toBe(true);
  });

  it('finds nodes by summary', async () => {
    const results = await searchNodes('second');
    expect(results.some((n) => n.id === 'n2')).toBe(true);
  });
});

describe('neighborhood', () => {
  it('returns focal node with edges and neighbors', async () => {
    await insertEdge(makeEdge('e3', 'n1', 'n2', 'knows'));

    const hood = await getNeighborhood('n1');
    expect(hood.node).not.toBeNull();
    expect(hood.node!.id).toBe('n1');
    expect(hood.edges.length).toBeGreaterThanOrEqual(1);
    expect(hood.neighbors['n2']).toBeDefined();
  });

  it('returns empty for missing node', async () => {
    const hood = await getNeighborhood('nonexistent');
    expect(hood.node).toBeNull();
    expect(hood.edges).toHaveLength(0);
  });
});

describe('loadFullGraph', () => {
  it('loads all nodes and edges', async () => {
    const graph = await loadFullGraph();
    expect(Object.keys(graph.nodes).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(graph.edges).length).toBeGreaterThanOrEqual(1);
  });
});
