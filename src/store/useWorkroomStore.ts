import { create } from 'zustand';
import type { User } from '../types/workroom';
import type { WorkroomState } from './workroomStoreTypes';
import { workroomApi } from './workroomApi';

const getInitialUser = (): User | null => {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('workroom_user') : null;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const useWorkroomStore = create<WorkroomState>((set, get) => ({
  currentUser: getInitialUser(),
  users: [],
  projects: [],
  currentProjectId: null,
  currentProject: null,
  epics: [],
  tasks: [],
  subtasks: [],
  dependencies: [],
  docs: [],
  activeView: 'list',
  isDocHubOpen: false,
  selectedTaskId: null,
  activePreviewDocId: null,
  selectedAssigneeFilter: null,
  isLoading: false,
  error: null,

  setActiveView: (activeView) => set({ activeView }),
  setIsDocHubOpen: (isDocHubOpen) => set({ isDocHubOpen }),
  toggleDocHub: () => set((s) => ({ isDocHubOpen: !s.isDocHubOpen })),
  setCurrentProjectId: (currentProjectId) => set({ currentProjectId }),
  setSelectedTaskId: (selectedTaskId) => set({ selectedTaskId }),
  setActivePreviewDocId: (activePreviewDocId) => set({ activePreviewDocId }),
  setSelectedAssigneeFilter: (selectedAssigneeFilter) => set({ selectedAssigneeFilter }),

  login: async (username, password) => {
    try {
      set({ isLoading: true, error: null });
      const { user } = await workroomApi.login(username, password);
      localStorage.setItem('workroom_user', JSON.stringify(user));
      set({ currentUser: user, isLoading: false });
      return true;
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      return false;
    }
  },

  register: async (registerData) => {
    try {
      set({ isLoading: true, error: null });
      const { user } = await workroomApi.register(registerData);
      localStorage.setItem('workroom_user', JSON.stringify(user));
      set({ currentUser: user, isLoading: false });
      return true;
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      return false;
    }
  },

  logout: () => {
    try {
      localStorage.removeItem('workroom_user');
    } catch {}
    set({
      currentUser: null,
      currentProjectId: null,
      currentProject: null,
      epics: [],
      tasks: [],
      subtasks: [],
      dependencies: [],
      docs: [],
      selectedTaskId: null,
    });
  },

  setCurrentUser: (currentUser) => set({ currentUser }),

  fetchUsers: async () => {
    try {
      const users = await workroomApi.getUsers();
      set({ users });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  fetchProjects: async () => {
    try {
      set({ isLoading: true, error: null });
      const projects = await workroomApi.getProjects();
      set({ projects, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  createProject: async (input) => {
    const project = await workroomApi.createProject(input);
    set((s) => ({ projects: [project, ...s.projects] }));
    return project;
  },

  deleteProject: async (id) => {
    await workroomApi.deleteProject(id);
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      currentProjectId: s.currentProjectId === id ? null : s.currentProjectId,
      currentProject: s.currentProject?.id === id ? null : s.currentProject,
    }));
  },

  loadProjectWorkspace: async (projectId) => {
    set({ currentProjectId: projectId, isLoading: true, error: null });
    await get().fetchProjectFullData(projectId);
  },

  fetchProjectFullData: async (projectId) => {
    try {
      set({ currentProjectId: projectId, isLoading: true, error: null });
      const data = await workroomApi.getProjectFull(projectId);
      set({
        currentProject: data.project,
        epics: data.epics,
        tasks: data.tasks,
        subtasks: data.subtasks,
        dependencies: data.dependencies,
        docs: data.docs,
        users: data.users,
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      console.error(`[WorkroomStore] Failed to fetch project full data for ${projectId}:`, err);
      set({ error: err.message, isLoading: false });
    }
  },

  createEpic: async (input) => {
    const epic = await workroomApi.createEpic(input);
    set((s) => ({ epics: [...s.epics, epic] }));
    return epic;
  },

  updateEpic: async (id, input) => {
    const updated = await workroomApi.updateEpic(id, input);
    set((s) => ({ epics: s.epics.map((e) => (e.id === id ? updated : e)) }));
    return updated;
  },

  deleteEpic: async (id) => {
    await workroomApi.deleteEpic(id);
    set((s) => ({
      epics: s.epics.filter((e) => e.id !== id),
      tasks: s.tasks.map((t) => (t.epicId === id ? { ...t, epicId: null } : t)),
    }));
  },

  createTask: async (input) => {
    const task = await workroomApi.createTask(input);
    set((s) => ({ tasks: [...s.tasks, task] }));
    return task;
  },

  updateTask: async (id, input) => {
    const updated = await workroomApi.updateTask(id, input);
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? updated : t)) }));
    return updated;
  },

  deleteTask: async (id) => {
    await workroomApi.deleteTask(id);
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      subtasks: s.subtasks.filter((st) => st.taskId !== id),
      dependencies: s.dependencies.filter((d) => d.sourceTaskId !== id && d.targetTaskId !== id),
      selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
    }));
  },

  moveTaskCanvas: async (id, canvasX, canvasY, epicId) => {
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, canvasX, canvasY, epicId: epicId !== undefined ? epicId : t.epicId } : t)),
    }));
    return await get().updateTask(id, { canvasX, canvasY, ...(epicId !== undefined ? { epicId } : {}) });
  },

  batchUpdatePositions: async (input) => {
    set((s) => {
      const epicMap = new Map(input.epics?.map((e) => [e.id, e]));
      const taskMap = new Map(input.tasks?.map((t) => [t.id, t]));
      return {
        epics: s.epics.map((e) => {
          const up = epicMap.get(e.id);
          return up ? { ...e, ...up } : e;
        }),
        tasks: s.tasks.map((t) => {
          const up = taskMap.get(t.id);
          return up ? { ...t, ...up } : t;
        }),
      };
    });
    await workroomApi.batchUpdatePositions(input);
  },

  createSubtask: async (input) => {
    const subtask = await workroomApi.createSubtask(input);
    set((s) => ({ subtasks: [...s.subtasks, subtask] }));
    return subtask;
  },

  updateSubtask: async (id, input) => {
    const updated = await workroomApi.updateSubtask(id, input);
    set((s) => ({ subtasks: s.subtasks.map((st) => (st.id === id ? updated : st)) }));
    return updated;
  },

  toggleSubtask: async (id) => {
    const current = get().subtasks.find((st) => st.id === id);
    if (!current) throw new Error('Subtask not found');
    return await get().updateSubtask(id, { isCompleted: !current.isCompleted });
  },

  deleteSubtask: async (id) => {
    await workroomApi.deleteSubtask(id);
    set((s) => ({ subtasks: s.subtasks.filter((st) => st.id !== id) }));
  },

  createDependency: async (input) => {
    const dep = await workroomApi.createDependency(input);
    set((s) => ({ dependencies: [...s.dependencies, dep] }));
    return dep;
  },

  deleteDependency: async (id) => {
    await workroomApi.deleteDependency(id);
    set((s) => ({ dependencies: s.dependencies.filter((d) => d.id !== id) }));
  },

  createDoc: async (input) => {
    const doc = await workroomApi.createDoc(input);
    set((s) => ({ docs: [doc, ...s.docs] }));
    return doc;
  },

  updateDoc: async (id, input) => {
    const updated = await workroomApi.updateDoc(id, input);
    set((s) => ({ docs: s.docs.map((d) => (d.id === id ? updated : d)) }));
    return updated;
  },

  deleteDoc: async (id) => {
    await workroomApi.deleteDoc(id);
    set((s) => ({
      docs: s.docs.filter((d) => d.id !== id),
      activePreviewDocId: s.activePreviewDocId === id ? null : s.activePreviewDocId,
    }));
  },

  resetDemoData: async () => {
    set({ isLoading: true });
    await workroomApi.resetSeed();
    const pid = get().currentProjectId;
    if (pid) await get().fetchProjectFullData(pid);
    set({ isLoading: false });
  },
}));
