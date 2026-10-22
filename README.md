# Mini Workroom MVP

A modern, high-craft project and task management workspace inspired by Linear, Notion, and FigJam. **Mini Workroom** combines structured task tracking with an infinite 2D spatial canvas and an integrated document hub.

---

## ✨ Features

- **Multi-Modal Views**:
  - **List View**: Hierarchical, structured task lists grouped by status or epic with inline editing and fast filtering.
  - **Kanban Board**: Drag-and-drop cards across columns (`Todo`, `In Progress`, `Review`, `Done`).
  - **2D Infinite Canvas**: Visual spatial task mapping with zoom, pan, and smooth navigation.
    - **Epic Containers**: Visually group tasks; moving an Epic automatically moves all enclosed tasks.
    - **Dependency Arrows**: Connect prerequisite and dependent tasks with interactive Bézier curves.
    - **Cycle Detection**: Prevents circular dependencies in real time.
    - **Auto Spatial Grouping**: Dropping a task into an Epic container automatically links the task to that Epic.
  - **Shared Document Hub**: Centralized documentation (Markdown, external links, notes) with interactive `@[Doc Title](doc:DOC_ID)` mention previews inside task descriptions.

- **Flexible Hierarchy**:
  - `Project > [Epic] > Task > [Subtask]`
  - Epics and Subtasks are strictly optional — tasks can exist standalone without requiring an epic container.

- **Design System**:
  - High-craft, minimalist light mode aesthetic (Linear / Notion / FigJam style).
  - High-contrast typography, crisp borders, and subtle elevation without unnecessary visual clutter.

---

## 🛠️ Tech Stack

- **Frontend**:
  - [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
  - [Vite](https://vitejs.dev/) for fast development and bundling
  - [Tailwind CSS](https://tailwindcss.com/) for utility-first styling
  - [Zustand](https://zustand-demo.pmnd.rs/) for performant state management
  - [Lucide React](https://lucide.dev/) for clean iconography
- **Backend & Database**:
  - [Node.js](https://nodejs.org/) & [Express](https://expressjs.com/)
  - [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (embedded, high-performance SQLite database)
  - Auto-migration and sample seed generator on boot

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Development Server

```bash
npm run dev
```

> **Note**: This single command starts both the Express API backend (`http://localhost:3001`) and the Vite frontend (`http://localhost:5173`) concurrently.
> The SQLite database (`server/workroom.db`) will be automatically created and populated with demo seed data on first run.

### 3. Verify & Run Tests

```bash
npm test
```

This executes the verification test suite (`server/verifyAll.ts`) testing the database schema, canvas sync coordinate logic, dependency graphs, and cycle detection.

---

## 📁 Project Structure

```text
Workroom/
├── server/
│   ├── db.ts               # SQLite initialization & schema
│   ├── seed.ts             # Demo data seeder
│   ├── routes/             # REST API endpoints (tasks, epics, docs, etc.)
│   ├── canvasSync.ts       # Canvas spatial math & epic bounds logic
│   ├── dependencyGraph.ts  # DAG cycle detection & dependency management
│   ├── verifyAll.ts        # Automated verification test suite
│   └── index.ts            # Express server entry point
├── src/
│   ├── components/         # UI Components (Views, Modals, Canvas, etc.)
│   │   ├── canvas/         # 2D Infinite Canvas, nodes & connection arrows
│   │   ├── kanban/         # Kanban board & drag-and-drop columns
│   │   ├── list/           # Structured list view
│   │   └── docs/           # Shared Document Hub
│   ├── store/              # Zustand global state store & API sync
│   ├── types/              # TypeScript data models and interfaces
│   ├── App.tsx             # Main App layout & view switcher
│   └── main.tsx            # React root entry point
├── package.json
└── vite.config.ts
```

---

## 📄 License

MIT
