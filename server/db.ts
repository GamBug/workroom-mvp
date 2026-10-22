import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { seedDataIfEmpty, resetDatabaseToSeed } from './seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure server directory exists
if (!fs.existsSync(__dirname)) {
  fs.mkdirSync(__dirname, { recursive: true });
}

const dbPath = path.resolve(__dirname, 'workroom.db');
export const db = new Database(dbPath);

// Enable foreign keys and WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  // 1. users
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_color TEXT NOT NULL
    );
  `);

  // 2. projects
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      owner_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 3. epics
  db.exec(`
    CREATE TABLE IF NOT EXISTS epics (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      color TEXT NOT NULL,
      canvas_x REAL DEFAULT 80,
      canvas_y REAL DEFAULT 80,
      canvas_width REAL DEFAULT 520,
      canvas_height REAL DEFAULT 360,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);

  // 4. tasks
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      epic_id TEXT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'todo',
      priority TEXT DEFAULT 'medium',
      assignee_id TEXT NULL,
      canvas_x REAL DEFAULT 120,
      canvas_y REAL DEFAULT 140,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (epic_id) REFERENCES epics(id) ON DELETE SET NULL,
      FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  // 5. subtasks
  db.exec(`
    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      is_completed INTEGER DEFAULT 0,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
  `);

  // 6. task_dependencies
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_task_id TEXT NOT NULL,
      target_task_id TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (source_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (target_task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
  `);

  // 7. project_docs
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_docs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      doc_type TEXT DEFAULT 'markdown',
      content TEXT DEFAULT '',
      updated_by TEXT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  seedDataIfEmpty();
}

export { seedDataIfEmpty, resetDatabaseToSeed };
