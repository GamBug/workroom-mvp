import express from 'express';
import cors from 'cors';
import { initDatabase } from './db.js';
import authRoutes from './routes/authRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import epicRoutes from './routes/epicRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import docRoutes from './routes/docRoutes.js';

// Initialize SQLite database and seed initial data
initDatabase();

export const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Mount modular route handlers
app.use('/api/auth', authRoutes);
app.use('/api', authRoutes); // /api/users
app.use('/api/projects', projectRoutes);
app.use('/api/epics', epicRoutes);
app.use('/api', taskRoutes);
app.use('/api', docRoutes);

// Start Express Server if executed directly (e.g. npm run dev)
const isMain = process.argv[1] && (process.argv[1].endsWith('server/index.ts') || process.argv[1].endsWith('server/index.js'));
if (isMain && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[Express Backend] Workroom API server listening on http://localhost:${PORT}`);
  });
}
