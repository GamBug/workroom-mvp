import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { mapTask, mapSubtask, mapDependency } from '../mappers.js';
import { wouldCreateCycle } from '../dependencyGraph.js';
import {
  computeTaskPositionInEpic,
  computeIndependentTaskPosition,
  adjustTaskPositionOnEpicChange,
} from '../canvasSync.js';

const router = Router();

// ==========================================
// Tasks Endpoints
// ==========================================
router.post('/tasks', (req: Request, res: Response) => {
  const {
    projectId, project_id,
    epicId, epic_id,
    title,
    description = '',
    status = 'todo',
    priority = 'medium',
    assigneeId, assignee_id,
    canvasX, canvas_x,
    canvasY, canvas_y,
  } = req.body;

  const pId = projectId || project_id;
  if (!pId || !title) {
    return res.status(400).json({ error: 'projectId and title are required' });
  }

  const id = `tsk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const epId = epicId !== undefined ? epicId : (epic_id || null);
  const assId = assigneeId !== undefined ? assigneeId : (assignee_id || null);

  let x = canvasX ?? canvas_x;
  let y = canvasY ?? canvas_y;
  if (x === undefined || y === undefined) {
    if (epId) {
      const autoPos = computeTaskPositionInEpic(pId, epId);
      if (x === undefined) x = autoPos.canvasX;
      if (y === undefined) y = autoPos.canvasY;
    } else {
      const autoPos = computeIndependentTaskPosition(pId);
      if (x === undefined) x = autoPos.canvasX;
      if (y === undefined) y = autoPos.canvasY;
    }
  }

  db.prepare(`
    INSERT INTO tasks (id, project_id, epic_id, title, description, status, priority, assignee_id, canvas_x, canvas_y)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, pId, epId, title, description, status, priority, assId, x, y);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return res.status(201).json(mapTask(task));
});

router.put('/tasks/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const current = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
  if (!current) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const {
    title = current.title,
    description = current.description,
    status = current.status,
    priority = current.priority,
    epicId, epic_id,
    assigneeId, assignee_id,
    canvasX, canvas_x,
    canvasY, canvas_y,
  } = req.body;

  const epId = epicId !== undefined ? epicId : (epic_id !== undefined ? epic_id : current.epic_id);
  const assId = assigneeId !== undefined ? assigneeId : (assignee_id !== undefined ? assignee_id : current.assignee_id);
  let x = canvasX ?? canvas_x ?? current.canvas_x;
  let y = canvasY ?? canvas_y ?? current.canvas_y;

  const hasExplicitCoords = (canvasX !== undefined || canvas_x !== undefined) && (canvasY !== undefined || canvas_y !== undefined);
  if (!hasExplicitCoords && epId !== current.epic_id) {
    const adjusted = adjustTaskPositionOnEpicChange(current, epId, current.project_id);
    x = adjusted.canvasX;
    y = adjusted.canvasY;
  }

  db.prepare(`
    UPDATE tasks
    SET title = ?, description = ?, status = ?, priority = ?, epic_id = ?, assignee_id = ?, canvas_x = ?, canvas_y = ?
    WHERE id = ?
  `).run(title, description, status, priority, epId, assId, x, y, id);

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return res.json(mapTask(updated));
});

router.delete('/tasks/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  db.prepare('DELETE FROM subtasks WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM task_dependencies WHERE source_task_id = ? OR target_task_id = ?').run(id, id);
  const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Task not found' });
  }
  return res.json({ success: true, id });
});

// PUT /api/canvas/batch-positions
router.put('/canvas/batch-positions', (req: Request, res: Response) => {
  const { epics = [], tasks = [] } = req.body;
  const updateEpic = db.prepare(`
    UPDATE epics
    SET canvas_x = COALESCE(?, canvas_x),
        canvas_y = COALESCE(?, canvas_y),
        canvas_width = COALESCE(?, canvas_width),
        canvas_height = COALESCE(?, canvas_height)
    WHERE id = ?
  `);
  const updateTask = db.prepare(`
    UPDATE tasks
    SET canvas_x = COALESCE(?, canvas_x),
        canvas_y = COALESCE(?, canvas_y),
        epic_id = CASE WHEN ? = 1 THEN ? ELSE epic_id END
    WHERE id = ?
  `);

  const tx = db.transaction(() => {
    for (const e of epics) {
      updateEpic.run(
        e.canvasX ?? e.canvas_x ?? null,
        e.canvasY ?? e.canvas_y ?? null,
        e.canvasWidth ?? e.canvas_width ?? null,
        e.canvasHeight ?? e.canvas_height ?? null,
        e.id
      );
    }
    for (const t of tasks) {
      const hasEpicId = (t.epicId !== undefined || t.epic_id !== undefined) ? 1 : 0;
      const epicIdVal = t.epicId !== undefined ? t.epicId : (t.epic_id !== undefined ? t.epic_id : null);
      updateTask.run(
        t.canvasX ?? t.canvas_x ?? null,
        t.canvasY ?? t.canvas_y ?? null,
        hasEpicId,
        epicIdVal,
        t.id
      );
    }
  });

  tx();
  return res.json({ success: true, epicsUpdated: epics.length, tasksUpdated: tasks.length });
});

// ==========================================
// Subtasks Endpoints
// ==========================================
router.post('/subtasks', (req: Request, res: Response) => {
  const { taskId, task_id, title, isCompleted = false, is_completed } = req.body;
  const tId = taskId || task_id;

  if (!tId || !title) {
    return res.status(400).json({ error: 'taskId and title are required' });
  }

  const id = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const doneVal = (isCompleted || is_completed === 1 || is_completed === true) ? 1 : 0;

  db.prepare(`
    INSERT INTO subtasks (id, task_id, title, is_completed)
    VALUES (?, ?, ?, ?)
  `).run(id, tId, title, doneVal);

  const subtask = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id);
  return res.status(201).json(mapSubtask(subtask));
});

router.put('/subtasks/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const current = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id) as any;
  if (!current) {
    return res.status(404).json({ error: 'Subtask not found' });
  }

  const { title = current.title, isCompleted, is_completed } = req.body;
  let doneVal = current.is_completed;
  if (isCompleted !== undefined) {
    doneVal = isCompleted ? 1 : 0;
  } else if (is_completed !== undefined) {
    doneVal = is_completed ? 1 : 0;
  }

  db.prepare(`
    UPDATE subtasks
    SET title = ?, is_completed = ?
    WHERE id = ?
  `).run(title, doneVal, id);

  const updated = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id);
  return res.json(mapSubtask(updated));
});

router.delete('/subtasks/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const info = db.prepare('DELETE FROM subtasks WHERE id = ?').run(id);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Subtask not found' });
  }
  return res.json({ success: true, id });
});

// ==========================================
// Dependencies Endpoints
// ==========================================
router.post('/dependencies', (req: Request, res: Response) => {
  const {
    projectId, project_id,
    sourceTaskId, source_task_id,
    targetTaskId, target_task_id,
  } = req.body;

  const pId = projectId || project_id;
  const srcId = sourceTaskId || source_task_id;
  const tgtId = targetTaskId || target_task_id;

  if (!pId || !srcId || !tgtId) {
    return res.status(400).json({ error: 'projectId, sourceTaskId, and targetTaskId are required' });
  }

  if (srcId === tgtId) {
    return res.status(400).json({ error: 'A task cannot depend on itself' });
  }

  const existing = db.prepare(`
    SELECT id FROM task_dependencies
    WHERE project_id = ? AND source_task_id = ? AND target_task_id = ?
  `).get(pId, srcId, tgtId);

  if (existing) {
    return res.status(409).json({ error: 'This dependency link already exists' });
  }

  if (wouldCreateCycle(pId, srcId, tgtId)) {
    return res.status(400).json({
      error: 'Không thể tạo liên kết vòng lặp (Circular Dependency)',
    });
  }

  const id = `dep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  db.prepare(`
    INSERT INTO task_dependencies (id, project_id, source_task_id, target_task_id)
    VALUES (?, ?, ?, ?)
  `).run(id, pId, srcId, tgtId);

  const dep = db.prepare('SELECT * FROM task_dependencies WHERE id = ?').get(id);
  return res.status(201).json(mapDependency(dep));
});

router.delete('/dependencies/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const info = db.prepare('DELETE FROM task_dependencies WHERE id = ?').run(id);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Dependency not found' });
  }
  return res.json({ success: true, id });
});

export default router;
