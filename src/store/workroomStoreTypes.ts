import type {
  User,
  Project,
  Epic,
  Task,
  Subtask,
  TaskDependency,
  ProjectDoc,
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
  WorkspaceView,
  BatchCanvasPositionInput,
} from '../types/workroom';

export interface WorkroomState {
  currentUser: User | null;
  users: User[];
  projects: Project[];
  currentProjectId: string | null;
  currentProject: Project | null;
  epics: Epic[];
  tasks: Task[];
  subtasks: Subtask[];
  dependencies: TaskDependency[];
  docs: ProjectDoc[];
  activeView: WorkspaceView;
  isDocHubOpen: boolean;
  selectedTaskId: string | null;
  activePreviewDocId: string | null;
  selectedAssigneeFilter: string | null;
  isLoading: boolean;
  error: string | null;

  // View & UI actions
  setActiveView: (view: WorkspaceView) => void;
  setIsDocHubOpen: (open: boolean) => void;
  toggleDocHub: () => void;
  setCurrentProjectId: (id: string | null) => void;
  setSelectedTaskId: (id: string | null) => void;
  setActivePreviewDocId: (id: string | null) => void;
  setSelectedAssigneeFilter: (userId: string | null) => void;
  resetDemoData: () => Promise<void>;

  // Auth actions
  login: (username: string, password: string) => Promise<boolean>;
  register: (data: { username: string; password: string; displayName: string; avatarColor?: string }) => Promise<boolean>;
  logout: () => void;
  setCurrentUser: (user: User | null) => void;
  fetchUsers: () => Promise<void>;

  // Projects actions
  fetchProjects: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  loadProjectWorkspace: (projectId: string) => Promise<void>;
  fetchProjectFullData: (projectId: string) => Promise<void>;

  // Epics actions
  createEpic: (input: CreateEpicInput) => Promise<Epic>;
  updateEpic: (id: string, input: UpdateEpicInput) => Promise<Epic>;
  deleteEpic: (id: string) => Promise<void>;

  // Tasks actions
  createTask: (input: CreateTaskInput) => Promise<Task>;
  updateTask: (id: string, input: UpdateTaskInput) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
  moveTaskCanvas: (id: string, canvasX: number, canvasY: number, epicId?: string | null) => Promise<Task>;
  batchUpdatePositions: (input: BatchCanvasPositionInput) => Promise<void>;

  // Subtasks actions
  createSubtask: (input: CreateSubtaskInput) => Promise<Subtask>;
  updateSubtask: (id: string, input: UpdateSubtaskInput) => Promise<Subtask>;
  toggleSubtask: (id: string) => Promise<Subtask>;
  deleteSubtask: (id: string) => Promise<void>;

  // Dependencies actions
  createDependency: (input: CreateDependencyInput) => Promise<TaskDependency>;
  deleteDependency: (id: string) => Promise<void>;

  // Project Docs actions
  createDoc: (input: CreateDocInput) => Promise<ProjectDoc>;
  updateDoc: (id: string, input: UpdateDocInput) => Promise<ProjectDoc>;
  deleteDoc: (id: string) => Promise<void>;
}
