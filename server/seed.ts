import { db } from './db.js';

export function seedDataIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count > 0) {
    return;
  }

  console.log('Seeding initial database with sample data...');

  const insertUser = db.prepare(`
    INSERT INTO users (id, username, password, display_name, avatar_color)
    VALUES (@id, @username, @password, @display_name, @avatar_color)
  `);

  const insertProject = db.prepare(`
    INSERT INTO projects (id, name, description, owner_id, created_at)
    VALUES (@id, @name, @description, @owner_id, @created_at)
  `);

  const insertEpic = db.prepare(`
    INSERT INTO epics (id, project_id, title, color, canvas_x, canvas_y, canvas_width, canvas_height)
    VALUES (@id, @project_id, @title, @color, @canvas_x, @canvas_y, @canvas_width, @canvas_height)
  `);

  const insertTask = db.prepare(`
    INSERT INTO tasks (id, project_id, epic_id, title, description, status, priority, assignee_id, canvas_x, canvas_y)
    VALUES (@id, @project_id, @epic_id, @title, @description, @status, @priority, @assignee_id, @canvas_x, @canvas_y)
  `);

  const insertSubtask = db.prepare(`
    INSERT INTO subtasks (id, task_id, title, is_completed)
    VALUES (@id, @task_id, @title, @is_completed)
  `);

  const insertDependency = db.prepare(`
    INSERT INTO task_dependencies (id, project_id, source_task_id, target_task_id)
    VALUES (@id, @project_id, @source_task_id, @target_task_id)
  `);

  const insertDoc = db.prepare(`
    INSERT INTO project_docs (id, project_id, title, category, doc_type, content, updated_by, updated_at)
    VALUES (@id, @project_id, @title, @category, @doc_type, @content, @updated_by, @updated_at)
  `);

  const now = new Date().toISOString();

  // Run in a transaction
  const seedTransaction = db.transaction(() => {
    // 1. Users
    insertUser.run({ id: 'usr_1', username: 'admin', password: '123', display_name: 'Administrator', avatar_color: '#6366f1' });
    insertUser.run({ id: 'usr_2', username: 'alice', password: '123', display_name: 'Alice Nguyen', avatar_color: '#ec4899' });
    insertUser.run({ id: 'usr_3', username: 'bob', password: '123', display_name: 'Bob Tran', avatar_color: '#10b981' });

    // 2. Project
    insertProject.run({
      id: 'prj_1',
      name: 'Website Redesign & Launch',
      description: 'Redesign corporate portal with modern canvas and task tracking',
      owner_id: 'usr_1',
      created_at: now,
    });

    // 3. Epics (2 sample epics with distinct coordinates)
    insertEpic.run({
      id: 'epic_1',
      project_id: 'prj_1',
      title: 'Phase 1: Design & Prototyping',
      color: '#3b82f6',
      canvas_x: 80,
      canvas_y: 80,
      canvas_width: 560,
      canvas_height: 400,
    });

    insertEpic.run({
      id: 'epic_2',
      project_id: 'prj_1',
      title: 'Phase 2: Core Engineering',
      color: '#10b981',
      canvas_x: 700,
      canvas_y: 80,
      canvas_width: 560,
      canvas_height: 400,
    });

    // 4. Tasks (3 inside Epics, 2 outside with epic_id = null)
    insertTask.run({
      id: 'tsk_1',
      project_id: 'prj_1',
      epic_id: 'epic_1',
      title: 'Design Figma UI Kit',
      description: 'Build design system components and token styles. Ref: @[Link Figma UI Kit](doc:doc_2)',
      status: 'done',
      priority: 'high',
      assignee_id: 'usr_2',
      canvas_x: 110,
      canvas_y: 140,
    });

    insertTask.run({
      id: 'tsk_2',
      project_id: 'prj_1',
      epic_id: 'epic_1',
      title: 'User Journey Mapping',
      description: 'Map user flows for onboarding and checkout flow',
      status: 'in_progress',
      priority: 'medium',
      assignee_id: 'usr_2',
      canvas_x: 380,
      canvas_y: 140,
    });

    insertTask.run({
      id: 'tsk_3',
      project_id: 'prj_1',
      epic_id: 'epic_2',
      title: 'Build REST API & Database',
      description: 'Implement SQLite schema and Express endpoints. Ref: @[Quy chuẩn đặt tên API](doc:doc_3)',
      status: 'todo',
      priority: 'high',
      assignee_id: 'usr_1',
      canvas_x: 730,
      canvas_y: 140,
    });

    insertTask.run({
      id: 'tsk_4',
      project_id: 'prj_1',
      epic_id: null,
      title: 'Setup CI/CD Pipeline',
      description: 'Configure GitHub Actions for automated linting and build checks',
      status: 'todo',
      priority: 'medium',
      assignee_id: 'usr_3',
      canvas_x: 150,
      canvas_y: 540,
    });

    insertTask.run({
      id: 'tsk_5',
      project_id: 'prj_1',
      epic_id: null,
      title: 'Legal & Compliance Audit',
      description: 'Review terms of service and GDPR privacy compliance',
      status: 'todo',
      priority: 'low',
      assignee_id: 'usr_1',
      canvas_x: 500,
      canvas_y: 540,
    });

    // 5. Subtasks
    insertSubtask.run({ id: 'sub_1', task_id: 'tsk_1', title: 'Color palette & Typography', is_completed: 1 });
    insertSubtask.run({ id: 'sub_2', task_id: 'tsk_1', title: 'Button & Input component sets', is_completed: 1 });
    insertSubtask.run({ id: 'sub_3', task_id: 'tsk_1', title: 'Export asset library', is_completed: 0 });

    insertSubtask.run({ id: 'sub_4', task_id: 'tsk_3', title: 'Create SQLite tables', is_completed: 1 });
    insertSubtask.run({ id: 'sub_5', task_id: 'tsk_3', title: 'Add seed data migration', is_completed: 1 });
    insertSubtask.run({ id: 'sub_6', task_id: 'tsk_3', title: 'Write CRUD endpoint handlers', is_completed: 0 });

    // 6. Dependencies (Task 1 -> Task 2 -> Task 3)
    insertDependency.run({ id: 'dep_1', project_id: 'prj_1', source_task_id: 'tsk_1', target_task_id: 'tsk_2' });
    insertDependency.run({ id: 'dep_2', project_id: 'prj_1', source_task_id: 'tsk_2', target_task_id: 'tsk_3' });

    // 7. Docs
    insertDoc.run({
      id: 'doc_1',
      project_id: 'prj_1',
      title: 'Tài liệu Kiến trúc Hệ thống',
      category: 'Architecture',
      doc_type: 'markdown',
      content: '# System Architecture\n\nFullstack React 18 + Vite + Express + SQLite architecture overview with flat relational schema.',
      updated_by: 'usr_1',
      updated_at: now,
    });

    insertDoc.run({
      id: 'doc_2',
      project_id: 'prj_1',
      title: 'Link Figma UI Kit',
      category: 'Design',
      doc_type: 'link',
      content: 'https://figma.com/file/sample-workroom-ui-kit',
      updated_by: 'usr_2',
      updated_at: now,
    });

    insertDoc.run({
      id: 'doc_3',
      project_id: 'prj_1',
      title: 'Quy chuẩn đặt tên API',
      category: 'Guidelines',
      doc_type: 'markdown',
      content: '# API Guidelines\n\n- RESTful naming conventions\n- JSON camelCase response payloads\n- Standard HTTP status codes\n- Unified workspace payload endpoint',
      updated_by: 'usr_1',
      updated_at: now,
    });
  });

  seedTransaction();
  console.log('Seed data successfully applied.');
}

export function resetDatabaseToSeed() {
  db.exec(`
    DELETE FROM task_dependencies;
    DELETE FROM subtasks;
    DELETE FROM project_docs;
    DELETE FROM tasks;
    DELETE FROM epics;
    DELETE FROM projects;
    DELETE FROM users;
  `);
  seedDataIfEmpty();
}
