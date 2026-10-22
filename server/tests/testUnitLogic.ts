import { checkCycleInEdges } from '../dependencyGraph.js';
import {
  findContainingEpic,
  createBezierPath,
  getBezierMidpoint,
} from '../../src/components/views/canvas/canvasGeometry.js';
import {
  computeNewEpicPosition,
  computeTaskPositionInEpic,
  adjustTaskPositionOnEpicChange,
  isTaskCenterInsideEpic,
} from '../canvasSync.js';
import { extractMentionedDocIds } from '../../src/utils/docMentions.js';
import { db } from '../db.js';
import type { AuditResult } from './testStaticAudit.js';

export function runUnitLogicTests(): AuditResult[] {
  const results: AuditResult[] = [];

  // ==========================================
  // 1. Dependency Graph Cycle Detection
  // ==========================================
  try {
    // A -> A (Self cycle)
    const selfCycle = checkCycleInEdges([], 'A', 'A');
    if (!selfCycle) throw new Error('Failed to block self-dependency A -> A');

    // A -> B, then B -> A (2-node cycle)
    const twoNodeCycle = checkCycleInEdges([{ sourceTaskId: 'A', targetTaskId: 'B' }], 'B', 'A');
    if (!twoNodeCycle) throw new Error('Failed to block 2-node cycle B -> A');

    // A -> B -> C -> D, then D -> A (Multi-node cycle)
    const multiEdges = [
      { sourceTaskId: 'A', targetTaskId: 'B' },
      { sourceTaskId: 'B', targetTaskId: 'C' },
      { sourceTaskId: 'C', targetTaskId: 'D' },
    ];
    const multiNodeCycle = checkCycleInEdges(multiEdges, 'D', 'A');
    if (!multiNodeCycle) throw new Error('Failed to block multi-node cycle D -> A');

    // Diamond DAG: A -> B, A -> C, B -> D, then C -> D (Valid DAG, should allow)
    const diamondEdges = [
      { sourceTaskId: 'A', targetTaskId: 'B' },
      { sourceTaskId: 'A', targetTaskId: 'C' },
      { sourceTaskId: 'B', targetTaskId: 'D' },
    ];
    const diamondValid = checkCycleInEdges(diamondEdges, 'C', 'D');
    if (diamondValid) throw new Error('Erroneously blocked valid diamond DAG edge C -> D');

    results.push({
      name: 'Algorithm: Dependency Graph Cycle Detection (DFS/BFS)',
      passed: true,
      details: 'Passed self-cycle, 2-node, multi-node, and diamond DAG tests',
    });
  } catch (err: any) {
    results.push({
      name: 'Algorithm: Dependency Graph Cycle Detection (DFS/BFS)',
      passed: false,
      details: err.message,
    });
  }

  // ==========================================
  // 2. Canvas Spatial Geometry (Hit-test & Bezier)
  // ==========================================
  try {
    const testEpics: any = [
      {
        id: 'epic_alpha',
        canvasX: 100,
        canvasY: 100,
        canvasWidth: 500,
        canvasHeight: 350,
      },
    ];

    // Task inside epic_alpha (center: 150+130=280, 150+55=205 => inside [100..600], [100..450])
    const insideResult = findContainingEpic(150, 150, testEpics);
    if (!insideResult || insideResult.id !== 'epic_alpha') {
      throw new Error(`Expected inside task to match epic_alpha, got: ${insideResult?.id}`);
    }

    // Task outside epic_alpha (center: 700+130=830 => outside)
    const outsideResult = findContainingEpic(700, 150, testEpics);
    if (outsideResult !== null) {
      throw new Error(`Expected outside task to return null, got: ${outsideResult?.id}`);
    }

    // Bezier SVG path generation
    const bezierStr = createBezierPath(100, 200, 400, 200);
    if (!bezierStr.startsWith('M 100 200 C') || bezierStr.includes('NaN')) {
      throw new Error(`Invalid Bezier curve generated: ${bezierStr}`);
    }

    // Bezier midpoint calculation at t = 0.5
    const mid = getBezierMidpoint(100, 200, 400, 200);
    if (isNaN(mid.x) || isNaN(mid.y) || mid.x !== 250 || mid.y !== 200) {
      throw new Error(`Unexpected midpoint: x=${mid.x}, y=${mid.y}`);
    }

    results.push({
      name: 'Algorithm: Canvas Geometry & Bezier Connectors',
      passed: true,
      details: 'Bounding box containment & Bezier midpoint formula verified',
    });
  } catch (err: any) {
    results.push({
      name: 'Algorithm: Canvas Geometry & Bezier Connectors',
      passed: false,
      details: err.message,
    });
  }

  // ==========================================
  // 3. Canvas Coordinate Synchronization Logic
  // ==========================================
  try {
    const testProjectId = `test_prj_sync_${Date.now()}`;
    db.prepare('INSERT INTO projects (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)').run(
      testProjectId,
      'Sync Test Project',
      'usr_1',
      new Date().toISOString()
    );

    // 1. Create two consecutive epics without explicit coordinates
    const epicPos1 = computeNewEpicPosition(testProjectId);
    db.prepare(`
      INSERT INTO epics (id, project_id, title, color, canvas_x, canvas_y, canvas_width, canvas_height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('sync_epic_1', testProjectId, 'Epic 1', '#3b82f6', epicPos1.canvasX, epicPos1.canvasY, 520, 360);

    const epicPos2 = computeNewEpicPosition(testProjectId);
    if (epicPos2.canvasX <= epicPos1.canvasX + 520) {
      throw new Error(`Epic 2 overlapping Epic 1: epicPos2.x=${epicPos2.canvasX}`);
    }
    db.prepare(`
      INSERT INTO epics (id, project_id, title, color, canvas_x, canvas_y, canvas_width, canvas_height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('sync_epic_2', testProjectId, 'Epic 2', '#10b981', epicPos2.canvasX, epicPos2.canvasY, 520, 360);

    // 2. Insert 4 tasks into sync_epic_1 and check grid distribution
    const taskCoords = [];
    for (let i = 0; i < 4; i++) {
      const pos = computeTaskPositionInEpic(testProjectId, 'sync_epic_1');
      taskCoords.push(pos);
      db.prepare(`
        INSERT INTO tasks (id, project_id, epic_id, title, canvas_x, canvas_y)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(`sync_t_${i}`, testProjectId, 'sync_epic_1', `Task ${i}`, pos.canvasX, pos.canvasY);
    }

    // Col 0 & Col 1 should differ by 280px in X
    if (taskCoords[1].canvasX - taskCoords[0].canvasX !== 280) {
      throw new Error('Column spacing mismatch in Epic task grid');
    }
    // Row 0 & Row 1 should differ by 135px in Y
    if (taskCoords[2].canvasY - taskCoords[0].canvasY !== 135) {
      throw new Error('Row spacing mismatch in Epic task grid');
    }

    // 3. Move task from independent to Epic 2
    const independentTask = {
      id: 'sync_indep',
      project_id: testProjectId,
      epic_id: null,
      title: 'Independent Task',
      canvas_x: 2000,
      canvas_y: 2000,
    };
    const adjusted = adjustTaskPositionOnEpicChange(independentTask, 'sync_epic_2', testProjectId);
    const epic2Row: any = db.prepare('SELECT * FROM epics WHERE id = ?').get('sync_epic_2');
    const isNowInside = isTaskCenterInsideEpic(adjusted.canvasX, adjusted.canvasY, epic2Row);
    if (!isNowInside) {
      throw new Error('adjustTaskPositionOnEpicChange failed to place task inside target epic');
    }

    // Cleanup test project
    db.prepare('DELETE FROM tasks WHERE project_id = ?').run(testProjectId);
    db.prepare('DELETE FROM epics WHERE project_id = ?').run(testProjectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);

    results.push({
      name: 'Algorithm: Multi-View Canvas Coordinate Sync',
      passed: true,
      details: 'Verified auto-layout offsets, grid 2-col stacking, and epic repositioning',
    });
  } catch (err: any) {
    results.push({
      name: 'Algorithm: Multi-View Canvas Coordinate Sync',
      passed: false,
      details: err.message,
    });
  }

  // ==========================================
  // 4. @Mention Parser Logic
  // ==========================================
  try {
    const sampleText = 'Vui lòng kiểm tra @[Kiến trúc](doc:doc_1) và @[UI Kit](doc:doc_2), kèm @[Kiến trúc lặp](doc:doc_1)';
    const ids = extractMentionedDocIds(sampleText);

    if (ids.length !== 2 || ids[0] !== 'doc_1' || ids[1] !== 'doc_2') {
      throw new Error(`Extracted docs mismatch: ${JSON.stringify(ids)}`);
    }

    results.push({
      name: 'Algorithm: Markdown @[Title](doc:ID) Mention Parser',
      passed: true,
      details: 'Extracted unique doc IDs and deduplicated duplicate mentions',
    });
  } catch (err: any) {
    results.push({
      name: 'Algorithm: Markdown @[Title](doc:ID) Mention Parser',
      passed: false,
      details: err.message,
    });
  }

  return results;
}
