export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';
export type DocType = 'markdown' | 'link' | 'note';
export type WorkspaceView = 'list' | 'kanban' | 'canvas';

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  createdAt: string;
}

export interface Epic {
  id: string;
  projectId: string;
  title: string;
  color: string;
  canvasX: number;
  canvasY: number;
  canvasWidth: number;
  canvasHeight: number;
}

export interface Task {
  id: string;
  projectId: string;
  epicId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  canvasX: number;
  canvasY: number;
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  isCompleted: boolean;
}

export interface TaskDependency {
  id: string;
  projectId: string;
  sourceTaskId: string;
  targetTaskId: string;
}

export interface ProjectDoc {
  id: string;
  projectId: string;
  title: string;
  category: string;
  docType: DocType;
  content: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface FullWorkspaceData {
  project: Project;
  epics: Epic[];
  tasks: Task[];
  subtasks: Subtask[];
  dependencies: TaskDependency[];
  docs: ProjectDoc[];
  users: User[];
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  ownerId: string;
}

export interface CreateEpicInput {
  projectId: string;
  title: string;
  color?: string;
  canvasX?: number;
  canvasY?: number;
  canvasWidth?: number;
  canvasHeight?: number;
}

export interface UpdateEpicInput {
  title?: string;
  color?: string;
  canvasX?: number;
  canvasY?: number;
  canvasWidth?: number;
  canvasHeight?: number;
}

export interface CreateTaskInput {
  projectId: string;
  epicId?: string | null;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  canvasX?: number;
  canvasY?: number;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  epicId?: string | null;
  assigneeId?: string | null;
  canvasX?: number;
  canvasY?: number;
}

export interface CreateSubtaskInput {
  taskId: string;
  title: string;
  isCompleted?: boolean;
}

export interface UpdateSubtaskInput {
  title?: string;
  isCompleted?: boolean;
}

export interface CreateDependencyInput {
  projectId: string;
  sourceTaskId: string;
  targetTaskId: string;
}

export interface CreateDocInput {
  projectId: string;
  title: string;
  category?: string;
  docType?: DocType;
  content?: string;
  updatedBy?: string | null;
}

export interface UpdateDocInput {
  title?: string;
  category?: string;
  docType?: DocType;
  content?: string;
  updatedBy?: string | null;
}

export interface BatchCanvasPositionInput {
  epics?: Array<{
    id: string;
    canvasX?: number;
    canvasY?: number;
    canvasWidth?: number;
    canvasHeight?: number;
  }>;
  tasks?: Array<{
    id: string;
    canvasX?: number;
    canvasY?: number;
    epicId?: string | null;
  }>;
}

