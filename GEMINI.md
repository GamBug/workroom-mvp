# PROJECT CONSTITUTION: MINI WORKROOM MVP

## 1. Tech Stack & Architecture
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + Lucide React + Zustand (state sync with backend API).
- **Backend**: Node.js + Express + `better-sqlite3` + CORS (single file database `server/workroom.db`).
- **Ports**: Backend runs on `http://localhost:3001`. Frontend runs on `http://localhost:5173` with Vite proxy `/api` -> `http://localhost:3001`.
- **Execution**: Use `concurrently` in root `package.json` so `npm run dev` starts both backend and frontend.

## 2. Database Schema (SQLite - Flat Relational)
Always maintain these exact table and column names (converted to camelCase in TypeScript interfaces):

1. `users`:
   - `id` TEXT PRIMARY KEY
   - `username` TEXT UNIQUE NOT NULL
   - `password` TEXT NOT NULL (plain text for MVP simplicity, no captcha)
   - `display_name` TEXT NOT NULL
   - `avatar_color` TEXT NOT NULL

2. `projects`:
   - `id` TEXT PRIMARY KEY
   - `name` TEXT NOT NULL
   - `description` TEXT DEFAULT ''
   - `owner_id` TEXT NOT NULL
   - `created_at` TEXT NOT NULL

3. `epics` (Optional container for Tasks):
   - `id` TEXT PRIMARY KEY
   - `project_id` TEXT NOT NULL
   - `title` TEXT NOT NULL
   - `color` TEXT NOT NULL
   - `canvas_x` REAL DEFAULT 80
   - `canvas_y` REAL DEFAULT 80
   - `canvas_width` REAL DEFAULT 520
   - `canvas_height` REAL DEFAULT 360

4. `tasks` (Core unit):
   - `id` TEXT PRIMARY KEY
   - `project_id` TEXT NOT NULL
   - `epic_id` TEXT NULL (NULL means unassigned to any Epic)
   - `title` TEXT NOT NULL
   - `description` TEXT DEFAULT '' (Supports `@[Doc Title](doc:DOC_ID)` syntax)
   - `status` TEXT DEFAULT 'todo' ('todo' | 'in_progress' | 'review' | 'done')
   - `priority` TEXT DEFAULT 'medium' ('low' | 'medium' | 'high')
   - `assignee_id` TEXT NULL
   - `canvas_x` REAL DEFAULT 120
   - `canvas_y` REAL DEFAULT 140

5. `subtasks` (Optional checklist inside a Task):
   - `id` TEXT PRIMARY KEY
   - `task_id` TEXT NOT NULL
   - `title` TEXT NOT NULL
   - `is_completed` INTEGER DEFAULT 0 (0 or 1)

6. `task_dependencies` (Task prerequisites / Canvas arrows):
   - `id` TEXT PRIMARY KEY
   - `project_id` TEXT NOT NULL
   - `source_task_id` TEXT NOT NULL (Prerequisite task)
   - `target_task_id` TEXT NOT NULL (Dependent task)

7. `project_docs` (Shared Document Hub like MS Teams Class Share):
   - `id` TEXT PRIMARY KEY
   - `project_id` TEXT NOT NULL
   - `title` TEXT NOT NULL
   - `category` TEXT DEFAULT 'General'
   - `doc_type` TEXT DEFAULT 'markdown' ('markdown' | 'link' | 'note')
   - `content` TEXT DEFAULT ''
   - `updated_by` TEXT NULL
   - `updated_at` TEXT NOT NULL

## 3. Core Engineering Rules (DO NOT VIOLATE)
1. **Optional Hierarchy**: `Epic` and `Subtask` are strictly optional. Every view (List, Kanban, Canvas) MUST gracefully render Tasks where `epic_id` is `null` and Tasks with 0 subtasks.
2. **Canvas Coordinate System**:
   - All `canvas_x` and `canvas_y` for both Epics and Tasks are stored in **Absolute World Coordinates**.
   - When an Epic container is dragged by `(dx, dy)`, all Tasks with `epic_id === epic.id` must also move by `(dx, dy)`.
   - When a Task card is dropped on the Canvas, check if its center point `(task.x + 120, task.y + 50)` is inside any Epic's bounding box `(epic.x, epic.y, epic.width, epic.height)`. If inside, set `task.epic_id = epic.id`; if outside all Epics, set `task.epic_id = null`.
3. **Single Source of Truth**: All Frontend views (`ListView`, `KanbanView`, `CanvasView`, `DocHubView`) must read and mutate data ONLY through `src/store/useWorkroomStore.ts` which syncs with `/api/...` endpoints.
4. **Defensive Coding**: Keep files modular under 300 lines. Never delete existing features when implementing a new view.

## 4. UI/UX Design System (High-Craft Light Mode - Anti-AI-Slop Rules)
1. **Strict Light Mode Palette (Linear / Notion / FigJam Style)**:
   - App Shell & Cards: Pure white `#FFFFFF` (`bg-white`), crisp 1px borders (`border-zinc-200`), subtle shadows (`shadow-[0_1px_3px_rgba(0,0,0,0.05)]`).
   - Workspace & Canvas Surface: Warm alabaster/stone `#F8F9FA` (`bg-zinc-50` or `bg-[#F7F7F5]`) with subtle dot matrix `#D4D4D8`.
   - Primary Text: `text-zinc-900`. Secondary Text: `text-zinc-500`. Muted: `text-zinc-400`.
   - Primary Buttons: High-contrast ink (`bg-zinc-900 text-white hover:bg-zinc-800`), NEVER neon emerald or glowing indigo gradients.
   - Secondary Controls: `bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50`.
2. **Anti-Slop Layout Rules**:
   - NO glowing borders, NO heavy drop-shadows, NO dark-mode slate/indigo backgrounds, NO `rounded-full` pill soup. Use clean `rounded-lg` (8px) or `rounded-md` (6px).
   - Remove redundant status/counter bars and permanent long instruction banners.
   - On Canvas: Hide connection ports (`+`) by default; only reveal them on card hover (`opacity-0 group-hover:opacity-100`). Do not repeat the Epic badge inside a CanvasTaskNode if the task is already inside an Epic container.
