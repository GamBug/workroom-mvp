import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { mapEpic } from '../mappers.js';
import { computeNewEpicPosition } from '../canvasSync.js';

const router = Router();

// POST /api/epics
router.post('/', (req: Request, res: Response) => {
  const {
    projectId, project_id,
    title,
    color = '#3b82f6',
    canvasX, canvas_x,
    canvasY, canvas_y,
    canvasWidth = 520, canvas_width = 520,
    canvasHeight = 360, canvas_height = 360,
  } = req.body;

  const pId = projectId || project_id;
  if (!pId || !title) {
    return res.status(400).json({ error: 'projectId and title are required' });
  }

  const id = `epic_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  let x = canvasX ?? canvas_x;
  let y = canvasY ?? canvas_y;
  if (x === undefined || y === undefined) {
    const autoPos = computeNewEpicPosition(pId);
    if (x === undefined) x = autoPos.canvasX;
    if (y === undefined) y = autoPos.canvasY;
  }
  const w = canvasWidth ?? canvas_width;
  const h = canvasHeight ?? canvas_height;

  db.prepare(`
    INSERT INTO epics (id, project_id, title, color, canvas_x, canvas_y, canvas_width, canvas_height)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, pId, title, color, x, y, w, h);

  const epic = db.prepare('SELECT * FROM epics WHERE id = ?').get(id);
  return res.status(201).json(mapEpic(epic));
});

// PUT /api/epics/:id
router.put('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const current = db.prepare('SELECT * FROM epics WHERE id = ?').get(id) as any;
  if (!current) {
    return res.status(404).json({ error: 'Epic not found' });
  }

  const {
    title = current.title,
    color = current.color,
    canvasX, canvas_x,
    canvasY, canvas_y,
    canvasWidth, canvas_width,
    canvasHeight, canvas_height,
  } = req.body;

  const x = canvasX ?? canvas_x ?? current.canvas_x;
  const y = canvasY ?? canvas_y ?? current.canvas_y;
  const w = canvasWidth ?? canvas_width ?? current.canvas_width;
  const h = canvasHeight ?? canvas_height ?? current.canvas_height;

  db.prepare(`
    UPDATE epics
    SET title = ?, color = ?, canvas_x = ?, canvas_y = ?, canvas_width = ?, canvas_height = ?
    WHERE id = ?
  `).run(title, color, x, y, w, h, id);

  const updated = db.prepare('SELECT * FROM epics WHERE id = ?').get(id);
  return res.json(mapEpic(updated));
});

// DELETE /api/epics/:id
router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  // Detach tasks from this epic before deletion (SET NULL)
  db.prepare('UPDATE tasks SET epic_id = NULL WHERE epic_id = ?').run(id);
  const info = db.prepare('DELETE FROM epics WHERE id = ?').run(id);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Epic not found' });
  }
  return res.json({ success: true, id });
});

export default router;
