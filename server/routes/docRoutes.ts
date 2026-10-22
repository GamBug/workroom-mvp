import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { resetDatabaseToSeed } from '../seed.js';
import { mapDoc } from '../mappers.js';

const router = Router();

// POST /api/docs
router.post('/docs', (req: Request, res: Response) => {
  const {
    projectId, project_id,
    title,
    category = 'General',
    docType = 'markdown', doc_type,
    content = '',
    updatedBy, updated_by,
  } = req.body;

  const pId = projectId || project_id;
  const dtype = docType || doc_type || 'markdown';
  const uBy = updatedBy || updated_by || null;

  if (!pId || !title) {
    return res.status(400).json({ error: 'projectId and title are required' });
  }

  const id = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const updatedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO project_docs (id, project_id, title, category, doc_type, content, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, pId, title, category, dtype, content, uBy, updatedAt);

  const doc = db.prepare('SELECT * FROM project_docs WHERE id = ?').get(id);
  return res.status(201).json(mapDoc(doc));
});

// PUT /api/docs/:id
router.put('/docs/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const current = db.prepare('SELECT * FROM project_docs WHERE id = ?').get(id) as any;
  if (!current) {
    return res.status(404).json({ error: 'Doc not found' });
  }

  const {
    title = current.title,
    category = current.category,
    docType, doc_type,
    content = current.content,
    updatedBy, updated_by,
  } = req.body;

  const dtype = docType || doc_type || current.doc_type;
  const uBy = updatedBy || updated_by || current.updated_by;
  const updatedAt = new Date().toISOString();

  db.prepare(`
    UPDATE project_docs
    SET title = ?, category = ?, doc_type = ?, content = ?, updated_by = ?, updated_at = ?
    WHERE id = ?
  `).run(title, category, dtype, content, uBy, updatedAt, id);

  const updated = db.prepare('SELECT * FROM project_docs WHERE id = ?').get(id);
  return res.json(mapDoc(updated));
});

// DELETE /api/docs/:id
router.delete('/docs/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const info = db.prepare('DELETE FROM project_docs WHERE id = ?').run(id);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Doc not found' });
  }
  return res.json({ success: true, id });
});

// POST /api/debug/reset-seed
router.post('/debug/reset-seed', (_req: Request, res: Response) => {
  resetDatabaseToSeed();
  return res.json({ success: true, message: 'Database reset to initial seed data' });
});

export default router;
