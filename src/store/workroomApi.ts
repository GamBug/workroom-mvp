import type {
  User,
  Project,
  Epic,
  Task,
  Subtask,
  TaskDependency,
  ProjectDoc,
  FullWorkspaceData,
  CreateProjectInput,
  CreateEpicInput,
  UpdateEpicInput,
  CreateTaskInput,
  UpdateTaskInput,
  CreateSubtaskInput,
  UpdateSubtaskInput,
  CreateDependencyInput,
  CreateDocInput,
  UpdateDocInput,
  BatchCanvasPositionInput,
} from '../types/workroom';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    let errMsg = `Request failed: ${res.status}`;
    try {
      const err = await res.json();
      if (err.error) errMsg = err.error;
    } catch {
      // ignore non-json
    }
    throw new Error(errMsg);
  }
  return res.json();
}

export const workroomApi = {
  // Auth
  login: (username: string, password: string) =>
    request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),

  register: (data: { username: string; password: string; displayName: string; avatarColor?: string }) =>
    request<{ user: User }>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  getUsers: () => request<User[]>('/api/users'),

  // Projects
  getProjects: () => request<Project[]>('/api/projects'),

  createProject: (input: CreateProjectInput) =>
    request<Project>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  deleteProject: (id: string) =>
    request<{ success: boolean; id: string }>(`/api/projects/${id}`, {
      method: 'DELETE',
    }),

  getProjectFull: (projectId: string) =>
    request<FullWorkspaceData>(`/api/projects/${projectId}/full`),

  // Epics
  createEpic: (input: CreateEpicInput) =>
    request<Epic>('/api/epics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  updateEpic: (id: string, input: UpdateEpicInput) =>
    request<Epic>(`/api/epics/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  deleteEpic: (id: string) =>
    request<{ success: boolean; id: string }>(`/api/epics/${id}`, {
      method: 'DELETE',
    }),

  // Tasks
  createTask: (input: CreateTaskInput) =>
    request<Task>('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  updateTask: (id: string, input: UpdateTaskInput) =>
    request<Task>(`/api/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  deleteTask: (id: string) =>
    request<{ success: boolean; id: string }>(`/api/tasks/${id}`, {
      method: 'DELETE',
    }),

  batchUpdatePositions: (input: BatchCanvasPositionInput) =>
    request<{ success: boolean }>('/api/canvas/batch-positions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  // Subtasks
  createSubtask: (input: CreateSubtaskInput) =>
    request<Subtask>('/api/subtasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  updateSubtask: (id: string, input: UpdateSubtaskInput) =>
    request<Subtask>(`/api/subtasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  deleteSubtask: (id: string) =>
    request<{ success: boolean; id: string }>(`/api/subtasks/${id}`, {
      method: 'DELETE',
    }),

  // Dependencies
  createDependency: (input: CreateDependencyInput) =>
    request<TaskDependency>('/api/dependencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  deleteDependency: (id: string) =>
    request<{ success: boolean; id: string }>(`/api/dependencies/${id}`, {
      method: 'DELETE',
    }),

  // Docs
  createDoc: (input: CreateDocInput) =>
    request<ProjectDoc>('/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  updateDoc: (id: string, input: UpdateDocInput) =>
    request<ProjectDoc>(`/api/docs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  deleteDoc: (id: string) =>
    request<{ success: boolean; id: string }>(`/api/docs/${id}`, {
      method: 'DELETE',
    }),

  resetSeed: () =>
    request<{ success: boolean }>('/api/debug/reset-seed', {
      method: 'POST',
    }),
};
