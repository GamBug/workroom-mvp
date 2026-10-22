import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { mapUser } from '../mappers.js';

const router = Router();

// POST /api/auth/login
router.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  return res.json({ user: mapUser(user) });
});

// POST /api/auth/register
router.post('/register', (req: Request, res: Response) => {
  const { username, password, displayName, avatarColor } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Username, password, and displayName are required' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const id = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const color = avatarColor || '#6366f1';

  db.prepare(`
    INSERT INTO users (id, username, password, display_name, avatar_color)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, username, password, displayName, color);

  const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return res.status(201).json({ user: mapUser(newUser) });
});

// GET /api/users
router.get('/users', (_req: Request, res: Response) => {
  const users = db.prepare('SELECT id, username, display_name, avatar_color FROM users').all();
  return res.json(users.map(mapUser));
});

export default router;
