import { db } from './db.js';

export interface DependencyEdge {
  sourceTaskId: string;
  targetTaskId: string;
}

/**
 * Pure function: Checks if adding a directed dependency edge (sourceTaskId -> targetTaskId)
 * would create a cycle (circular dependency) given a list of existing edges.
 *
 * An edge (source -> target) creates a cycle if and only if there is
 * already a reachable path from target back to source.
 */
export function checkCycleInEdges(
  edges: DependencyEdge[],
  sourceTaskId: string,
  targetTaskId: string
): boolean {
  if (sourceTaskId === targetTaskId) {
    return true;
  }

  // Build adjacency list: node -> outgoing neighbor task IDs
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adj.get(edge.sourceTaskId) || [];
    list.push(edge.targetTaskId);
    adj.set(edge.sourceTaskId, list);
  }

  // BFS starting from targetTaskId to check if sourceTaskId is reachable
  const queue: string[] = [targetTaskId];
  const visited = new Set<string>([targetTaskId]);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === sourceTaskId) {
      return true; // Cycle detected!
    }

    const neighbors = adj.get(curr) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return false;
}

/**
 * Checks if adding a directed dependency edge (sourceTaskId -> targetTaskId)
 * would create a cycle (circular dependency) in the SQLite project database.
 */
export function wouldCreateCycle(
  projectId: string,
  sourceTaskId: string,
  targetTaskId: string
): boolean {
  if (sourceTaskId === targetTaskId) {
    return true;
  }

  // Fetch all existing dependency edges for this project
  const rows = db
    .prepare(
      'SELECT source_task_id, target_task_id FROM task_dependencies WHERE project_id = ?'
    )
    .all(projectId) as Array<{
    source_task_id: string;
    target_task_id: string;
  }>;

  const edges: DependencyEdge[] = rows.map((r) => ({
    sourceTaskId: r.source_task_id,
    targetTaskId: r.target_task_id,
  }));

  return checkCycleInEdges(edges, sourceTaskId, targetTaskId);
}
