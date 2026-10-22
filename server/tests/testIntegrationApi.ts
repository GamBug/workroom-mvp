import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { app } from '../index.js';
import { db } from '../db.js';
import type { AuditResult } from './testStaticAudit.js';

export async function runIntegrationApiTests(): Promise<AuditResult[]> {
  const results: AuditResult[] = [];

  // Start Express on ephemeral port
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://localhost:${port}`;

  const fetchJson = async (path: string, options?: RequestInit) => {
    const res = await fetch(`${baseUrl}${path}`, options);
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  };

  try {
    // 1. Reset & Seed + Full Project Workspace verification
    const resetRes = await fetchJson('/api/debug/reset-seed', { method: 'POST' });
    const fullRes = await fetchJson('/api/projects/prj_1/full');
    const validFull =
      resetRes.status === 200 &&
      fullRes.status === 200 &&
      fullRes.data?.project?.id === 'prj_1' &&
      Array.isArray(fullRes.data?.epics) && fullRes.data.epics.length > 0 &&
      Array.isArray(fullRes.data?.tasks) && fullRes.data.tasks.length > 0 &&
      Array.isArray(fullRes.data?.subtasks) && fullRes.data.subtasks.length > 0 &&
      Array.isArray(fullRes.data?.dependencies) && fullRes.data.dependencies.length > 0 &&
      Array.isArray(fullRes.data?.docs) && fullRes.data.docs.length > 0 &&
      Array.isArray(fullRes.data?.users) && fullRes.data.users.length > 0;

    results.push({
      name: 'Integration: Reset Seed & Full Project Data Aggregation',
      passed: Boolean(validFull),
      details: validFull
        ? 'Restored seed DB and fetched full project payload with all 7 relational entities'
        : `Failed reset or payload validation: ${JSON.stringify(fullRes.data)}`,
    });

    // 2. Authentication Flow & Conflict Handling
    const testUsername = `user_${Date.now()}`;
    const regRes = await fetchJson('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: 'password123',
        displayName: 'Audit User',
        avatarColor: '#10b981',
      }),
    });

    const loginRes = await fetchJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testUsername, password: 'password123' }),
    });

    const dupRes = await fetchJson('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: 'otherpassword',
        displayName: 'Duplicate User',
      }),
    });

    const authOk = regRes.status === 201 && loginRes.status === 200 && dupRes.status === 409;
    results.push({
      name: 'Integration: Auth Register, Login & Duplicate Username Ban',
      passed: authOk,
      details: authOk
        ? 'Registration succeeded (201), Login succeeded (200), Duplicate username rejected (409)'
        : `Auth flow issue: reg=${regRes.status}, login=${loginRes.status}, dup=${dupRes.status}`,
    });

    // 3. Optional Hierarchy & Epic Delete Soft Unlink
    // Create independent task
    const indepTaskRes = await fetchJson('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'prj_1',
        title: 'Audit Independent Task',
        epicId: null,
      }),
    });
    const createdTaskId = indepTaskRes.data?.id;

    // Create temporary epic
    const newEpicRes = await fetchJson('/api/epics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'prj_1', title: 'Audit Temp Epic' }),
    });
    const createdEpicId = newEpicRes.data?.id;

    // Assign task to epic
    await fetchJson(`/api/tasks/${createdTaskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epicId: createdEpicId }),
    });

    // Delete Epic
    await fetchJson(`/api/epics/${createdEpicId}`, { method: 'DELETE' });

    // Verify task still exists and epicId is null
    const taskAfterEpicDel = db.prepare('SELECT * FROM tasks WHERE id = ?').get(createdTaskId) as any;
    const hierarchyOk = taskAfterEpicDel && taskAfterEpicDel.epic_id === null;

    results.push({
      name: 'Integration: Optional Hierarchy & Epic Deletion Unlink (SET NULL)',
      passed: Boolean(hierarchyOk),
      details: hierarchyOk
        ? 'Task remained intact with epic_id automatically reset to NULL on epic deletion'
        : 'Task was unintentionally deleted or epic_id not set to NULL',
    });

    // 4. Cascade Deletion of Task (Subtasks & Dependencies Cleanup)
    const cascadeTaskRes = await fetchJson('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'prj_1', title: 'Task To Delete Cascade' }),
    });
    const cTaskId = cascadeTaskRes.data?.id;

    await fetchJson('/api/subtasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: cTaskId, title: 'Cascade Subtask 1' }),
    });
    await fetchJson('/api/subtasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: cTaskId, title: 'Cascade Subtask 2' }),
    });
    await fetchJson('/api/dependencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'prj_1', sourceTaskId: cTaskId, targetTaskId: 'tsk_4' }),
    });

    // Delete task
    await fetchJson(`/api/tasks/${cTaskId}`, { method: 'DELETE' });

    const orphanSubtasks = (db.prepare('SELECT COUNT(*) as count FROM subtasks WHERE task_id = ?').get(cTaskId) as any).count;
    const orphanDeps = (db.prepare('SELECT COUNT(*) as count FROM task_dependencies WHERE source_task_id = ? OR target_task_id = ?').get(cTaskId, cTaskId) as any).count;
    const cascadeOk = orphanSubtasks === 0 && orphanDeps === 0;

    results.push({
      name: 'Integration: Task Deletion Cascade (0 Orphan Subtasks & Deps)',
      passed: cascadeOk,
      details: cascadeOk
        ? 'Subtasks and dependency edges cleanly purged from SQLite on task removal'
        : `Orphans found: subtasks=${orphanSubtasks}, dependencies=${orphanDeps}`,
    });

    // 5. Canvas Batch Positions Atomic Transaction
    const batchRes = await fetchJson('/api/canvas/batch-positions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        epics: [{ id: 'epic_1', canvasX: 333, canvasY: 444 }],
        tasks: [
          { id: 'tsk_1', canvasX: 350, canvasY: 470 },
          { id: 'tsk_2', canvasX: 620, canvasY: 470 },
        ],
      }),
    });
    const epic1Updated: any = db.prepare('SELECT canvas_x, canvas_y FROM epics WHERE id = ?').get('epic_1');
    const task1Updated: any = db.prepare('SELECT canvas_x, canvas_y FROM tasks WHERE id = ?').get('tsk_1');
    const batchOk =
      batchRes.status === 200 &&
      epic1Updated.canvas_x === 333 &&
      epic1Updated.canvas_y === 444 &&
      task1Updated.canvas_x === 350 &&
      task1Updated.canvas_y === 470;

    results.push({
      name: 'Integration: Canvas Batch Positions Atomic SQLite Transaction',
      passed: batchOk,
      details: batchOk
        ? 'Atomic transaction updated multiple epic and task coordinates simultaneously'
        : 'Failed batch position update in SQLite',
    });

    // 6. Project Docs CRUD
    const createDocRes = await fetchJson('/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'prj_1',
        title: 'Audit Test Manual',
        category: 'Testing',
        docType: 'markdown',
        content: '# Test Content',
      }),
    });
    const docId = createDocRes.data?.id;

    const updateDocRes = await fetchJson(`/api/docs/${docId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Audit Test Manual v2' }),
    });

    const deleteDocRes = await fetchJson(`/api/docs/${docId}`, { method: 'DELETE' });
    const docInDb = db.prepare('SELECT id FROM project_docs WHERE id = ?').get(docId);
    const docOk = createDocRes.status === 201 && updateDocRes.status === 200 && deleteDocRes.status === 200 && !docInDb;

    results.push({
      name: 'Integration: Shared Document Hub (Create, Update, Delete)',
      passed: Boolean(docOk),
      details: docOk
        ? 'Doc lifecycle verified: created markdown doc, updated title, deleted cleanly'
        : 'Doc Hub CRUD failed',
    });

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return results;
}
