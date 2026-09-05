/**
 * js/workroom/core.js - Shared Application State & Core Utilities
 *
 * Responsibilities:
 * - Maintain the single canonical application state tree.
 * - Centralize application configuration constants.
 * - Expose the REST API wrapper (fetch client with session handling).
 * - Single source of truth for date arithmetic and due state derivations.
 * - Single source of truth for Search & Filter visible task derivation.
 * - Toast notification feedback helper.
 * - Generic modal dialog lifecycle helpers.
 */

// =====================================================================
// 1. CANONICAL APPLICATION STATE
// =====================================================================

export const state = {
  currentUser: null,

  // High-level screen: "dashboard" | "project" (Dashboard is default landing screen)
  screen: "dashboard",

  // Projects collection owned or collaborated on by current user
  projects: [],
  selectedProjectId: null,

  // Tasks belonging to currently selected project
  tasks: [],

  // Project workspace view mode: "kanban" (default) | "list" | "canvas"
  view: sessionStorage.getItem("workroom_view") || "kanban",

  // Project-level search and filter criteria
  searchQuery: "",
  statusFilter: "all",
  dueFilter: "all",
  assigneeFilter: "all",

  // Raw data for the Dashboard overview
  dashboard: {
    projects: [],
    tasks: []
  },

  isSubmitting: false, // Prevents duplicate submissions on rapid clicks
  activeModal: null,
  pendingDeleteProjectId: null,
  pendingDeleteTaskId: null,
  pendingRemoveMember: null,
  pendingDeleteCommentId: null,
  editingTaskId: null,
  projectMembers: [],

  // Canvas view layout, positions, camera, and dependencies state
  canvas: {
    positions: {}, // { [taskId]: { x: number, y: number } }
    dependencies: [], // [ { from_task_id: number, to_task_id: number, created_at: string } ]
    selectedDependency: null, // { from_task_id: number, to_task_id: number } | null
    pendingDeleteDependency: null,
    isConnecting: false,
    connectSourceTaskId: null,
    loading: false,
    loadedProjectId: null,
    surfaceWidth: 2000,
    surfaceHeight: 1200,
    camera: {
      panX: 0,
      panY: 0,
      zoom: 1.0
    },
    isPanning: false,
    spacePressed: false,
    pendingCreatePosition: null,
    justPanned: false,
    justConnected: false,
    minimap: {
      isDraggingViewport: false
    }
  },

  // Lightweight multi-user synchronization state (HTTP periodic polling)
  sync: {
    projectId: null,
    lastRevision: null,
    timerId: null,
    inFlight: false,
    deferred: false,
    pendingRevision: null,
    isDragging: false,
    pollSeq: 0
  },
  taskModalSnapshot: null // Initial values snapshot when edit task modal is opened
};

// =====================================================================
// 2. CONSTANTS
// =====================================================================

// Allowed task statuses in exact progression order
export const STATUSES = ["Todo", "Doing", "Review", "Done"];

// Canvas zoom configuration constants
export const CANVAS_MIN_ZOOM = 0.5;
export const CANVAS_MAX_ZOOM = 2.0;
export const CANVAS_ZOOM_STEP = 0.1;

// Periodic polling interval for lightweight multi-user synchronization (~5 seconds)
export const SYNC_POLL_INTERVAL = 5000;

// =====================================================================
// 3. API CLIENT
// =====================================================================

export const api = {
  async request(url, options = {}) {
    try {
      const response = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        },
        ...options
      });

      // Session expired or unauthenticated: redirect to login
      if (response.status === 401) {
        window.location.href = "/";
        return null;
      }

      const data = await response.json();
      return { ok: response.ok, status: response.status, data };
    } catch (err) {
      if (!options.silent) {
        console.error("Network / API Error:", err);
        showToast("Unable to reach server. Please check your connection.", "error");
      }
      return null;
    }
  },

  get(url) {
    return this.request(url, { method: "GET" });
  },

  post(url, body) {
    return this.request(url, {
      method: "POST",
      body: JSON.stringify(body)
    });
  },

  patch(url, body) {
    return this.request(url, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  },

  delete(url) {
    return this.request(url, { method: "DELETE" });
  }
};

// =====================================================================
// 4. TOAST NOTIFICATION FEEDBACK
// =====================================================================

export function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  // Auto-remove toast after 3 seconds
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(6px)";
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

// =====================================================================
// 5. DATE & DUE STATUS HELPERS
// =====================================================================

/**
 * Parses a 'YYYY-MM-DD' date string as local calendar date components.
 * Prevents browser UTC timezone off-by-one shifts.
 */
export function parseLocalDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const parts = dateStr.trim().split("-");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // 0-indexed month
  const day = parseInt(parts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return new Date(year, month, day, 0, 0, 0, 0);
}

/**
 * Calculates the difference in whole calendar days between the date and today.
 */
export function getDaysDiffFromToday(dateStr) {
  const targetDate = parseLocalDate(dateStr);
  if (!targetDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((targetDate.getTime() - today.getTime()) / msPerDay);
}

/**
 * Determines the task due state: 'overdue', 'due-soon', 'normal', 'done', or 'none'.
 * Rule: Tasks with status === 'Done' are never marked overdue or due-soon.
 */
export function getTaskDueState(task) {
  if (!task || !task.due_date || !task.due_date.trim()) {
    return { type: "none", label: "", shortLabel: "", formattedDate: "", diffDays: null };
  }

  const diffDays = getDaysDiffFromToday(task.due_date);
  if (diffDays === null) {
    return { type: "none", label: "", shortLabel: "", formattedDate: "", diffDays: null };
  }

  const targetDate = parseLocalDate(task.due_date);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const formattedDate = targetDate ? `${monthNames[targetDate.getMonth()]} ${targetDate.getDate()}` : task.due_date;

  // Done tasks: neutral completed indicator (never overdue or due soon)
  if (task.status === "Done") {
    return {
      type: "done",
      label: `Completed (Due ${formattedDate})`,
      shortLabel: formattedDate,
      formattedDate,
      diffDays
    };
  }

  // Overdue: past due date (< 0 days diff)
  if (diffDays < 0) {
    const daysOverdue = Math.abs(diffDays);
    const dayText = daysOverdue === 1 ? "1 day overdue" : `${daysOverdue} days overdue`;
    return {
      type: "overdue",
      label: `Overdue · ${formattedDate} (${dayText})`,
      shortLabel: `Overdue · ${formattedDate}`,
      formattedDate,
      diffDays
    };
  }

  // Due Soon: within 0 to 3 days from today
  if (diffDays >= 0 && diffDays <= 3) {
    let soonText = "";
    if (diffDays === 0) soonText = "Today";
    else if (diffDays === 1) soonText = "Tomorrow";
    else soonText = `In ${diffDays}d`;

    return {
      type: "due-soon",
      label: `Due ${soonText} · ${formattedDate}`,
      shortLabel: `Due soon · ${formattedDate}`,
      formattedDate,
      diffDays
    };
  }

  // Normal future date (> 3 days)
  return {
    type: "normal",
    label: `Due ${formattedDate}`,
    shortLabel: formattedDate,
    formattedDate,
    diffDays
  };
}

/**
 * Creates a DOM badge element for a task's due date.
 */
export function renderDueBadgeElement(task, isCompact = false) {
  const dueState = getTaskDueState(task);
  if (dueState.type === "none") return null;

  const badge = document.createElement("span");
  badge.className = `due-badge ${dueState.type}`;
  badge.title = dueState.label;

  // Small calendar SVG icon
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "11");
  svg.setAttribute("height", "11");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", "3");
  rect.setAttribute("y", "4");
  rect.setAttribute("width", "18");
  rect.setAttribute("height", "18");
  rect.setAttribute("rx", "2");
  rect.setAttribute("ry", "2");
  svg.appendChild(rect);

  const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line1.setAttribute("x1", "16");
  line1.setAttribute("y1", "2");
  line1.setAttribute("x2", "16");
  line1.setAttribute("y2", "6");
  svg.appendChild(line1);

  const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line2.setAttribute("x1", "8");
  line2.setAttribute("y1", "2");
  line2.setAttribute("x2", "8");
  line2.setAttribute("y2", "6");
  svg.appendChild(line2);

  const line3 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line3.setAttribute("x1", "3");
  line3.setAttribute("y1", "10");
  line3.setAttribute("x2", "21");
  line3.setAttribute("y2", "10");
  svg.appendChild(line3);

  badge.appendChild(svg);

  const textSpan = document.createElement("span");
  textSpan.textContent = isCompact ? (dueState.shortLabel || dueState.formattedDate) : dueState.label;
  badge.appendChild(textSpan);

  return badge;
}

// =====================================================================
// 6. SEARCH & FILTER DERIVATION HELPERS
// =====================================================================

/**
 * Helper to determine if a task matches the current assignee filter.
 * Compares strictly by user ID, never by username string.
 */
export function matchesAssigneeFilter(task) {
  if (!state.assigneeFilter || state.assigneeFilter === "all") {
    return true;
  }
  if (state.assigneeFilter === "me") {
    return Boolean(state.currentUser && state.currentUser.id != null && task.assignee_id === state.currentUser.id);
  }
  if (state.assigneeFilter === "unassigned") {
    return task.assignee_id == null;
  }
  let targetId = state.assigneeFilter;
  if (typeof targetId === "string" && targetId.startsWith("user:")) {
    targetId = parseInt(targetId.substring(5), 10);
  } else {
    targetId = parseInt(targetId, 10);
  }
  if (isNaN(targetId)) return true;
  return task.assignee_id === targetId;
}

/**
 * Derives the list of tasks visible under current search and filter criteria
 * without mutating canonical state.tasks.
 */
export function getVisibleTasks() {
  const query = (state.searchQuery || "").trim().toLowerCase();

  return state.tasks.filter(task => {
    // 1. Status Filter
    if (state.statusFilter !== "all" && task.status !== state.statusFilter) {
      return false;
    }

    // 2. Due Date Filter
    if (state.dueFilter !== "all") {
      const dueState = getTaskDueState(task);
      if (state.dueFilter === "due-soon" && dueState.type !== "due-soon") {
        return false;
      }
      if (state.dueFilter === "overdue" && dueState.type !== "overdue") {
        return false;
      }
      if (state.dueFilter === "no-due" && task.due_date && task.due_date.trim()) {
        return false;
      }
    }

    // 3. Assignee Filter
    if (!matchesAssigneeFilter(task)) {
      return false;
    }

    // 4. Text Search Query (matches title or description case-insensitively)
    if (query) {
      const titleMatch = (task.title || "").toLowerCase().includes(query);
      const descMatch = (task.description || "").toLowerCase().includes(query);
      if (!titleMatch && !descMatch) {
        return false;
      }
    }

    return true;
  });
}

// =====================================================================
// 7. GENERIC MODAL HELPERS
// =====================================================================

export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  modal.style.display = "flex";
  state.activeModal = modalId;

  // Auto-focus primary input
  const firstInput = modal.querySelector("input:not([type=hidden]), textarea, select, button.btn-primary, button.btn-danger");
  if (firstInput) {
    setTimeout(() => firstInput.focus(), 50);
  }
}

export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = "none";
  }
  if (state.activeModal === modalId) {
    state.activeModal = null;
  }
  if (modalId === "modal-edit-task") {
    state.editingTaskId = null;
    state.taskModalSnapshot = null;
    const notice = document.getElementById("task-edit-remote-notice");
    if (notice) notice.style.display = "none";
  }
}
