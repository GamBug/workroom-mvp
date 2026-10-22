// Helper mappers from DB snake_case rows to TypeScript camelCase interfaces
export const mapUser = (row: any) => (!row ? null : {
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  avatarColor: row.avatar_color,
});

export const mapProject = (row: any) => (!row ? null : {
  id: row.id,
  name: row.name,
  description: row.description || '',
  ownerId: row.owner_id,
  createdAt: row.created_at,
});

export const mapEpic = (row: any) => (!row ? null : {
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  color: row.color,
  canvasX: Number(row.canvas_x),
  canvasY: Number(row.canvas_y),
  canvasWidth: Number(row.canvas_width),
  canvasHeight: Number(row.canvas_height),
});

export const mapTask = (row: any) => (!row ? null : {
  id: row.id,
  projectId: row.project_id,
  epicId: row.epic_id || null,
  title: row.title,
  description: row.description || '',
  status: row.status,
  priority: row.priority,
  assigneeId: row.assignee_id || null,
  canvasX: Number(row.canvas_x),
  canvasY: Number(row.canvas_y),
});

export const mapSubtask = (row: any) => (!row ? null : {
  id: row.id,
  taskId: row.task_id,
  title: row.title,
  isCompleted: Boolean(row.is_completed),
});

export const mapDependency = (row: any) => (!row ? null : {
  id: row.id,
  projectId: row.project_id,
  sourceTaskId: row.source_task_id,
  targetTaskId: row.target_task_id,
});

export const mapDoc = (row: any) => (!row ? null : {
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  category: row.category || 'General',
  docType: row.doc_type || 'markdown',
  content: row.content || '',
  updatedBy: row.updated_by || null,
  updatedAt: row.updated_at,
});
