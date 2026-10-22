import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import {
  mapProject,
  mapEpic,
  mapTask,
  mapSubtask,
  mapDependency,
  mapDoc,
  mapUser,
} from '../mappers.js';

const router = Router();

// GET /api/projects
router.get('/', (_req: Request, res: Response) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  return res.json(projects.map(mapProject));
});

// POST /api/projects
router.post('/', (req: Request, res: Response) => {
  const { name, description = '', ownerId, owner_id } = req.body;
  const owner = ownerId || owner_id;

  if (!name || !owner) {
    return res.status(400).json({ error: 'Project name and ownerId are required' });
  }

  const id = `prj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects (id, name, description, owner_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, description, owner, createdAt);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  return res.status(201).json(mapProject(project));
});

// DELETE /api/projects/:id
router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const info = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Project not found' });
  }
  return res.json({ success: true, id });
});

// GET /api/projects/:id/full (Full workspace data in 1 request)
router.get('/:id/full', (req: Request, res: Response) => {
  const { id } = req.params;

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const epics = db.prepare('SELECT * FROM epics WHERE project_id = ?').all(id);
  const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ?').all(id);

  // Get all subtasks for tasks in this project
  const subtasks = db.prepare(`
    SELECT s.* FROM subtasks s
    JOIN tasks t ON s.task_id = t.id
    WHERE t.project_id = ?
  `).all(id);

  const dependencies = db.prepare('SELECT * FROM task_dependencies WHERE project_id = ?').all(id);
  const docs = db.prepare('SELECT * FROM project_docs WHERE project_id = ? ORDER BY updated_at DESC').all(id);
  const users = db.prepare('SELECT id, username, display_name, avatar_color FROM users').all();

  return res.json({
    project: mapProject(project),
    epics: epics.map(mapEpic),
    tasks: tasks.map(mapTask),
    subtasks: subtasks.map(mapSubtask),
    dependencies: dependencies.map(mapDependency),
    docs: docs.map(mapDoc),
    users: users.map(mapUser),
  });
});

export default router;
