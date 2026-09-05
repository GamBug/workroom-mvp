/**
 * workroom.js - Main Application Logic for Workroom Mini
 * 
 * Responsibilities:
 * - Maintain client-side application state:
 *   * screen: "dashboard" vs "project"
 *   * view: "kanban" vs "list" (inside project screen)
 *   * projects list, selected project, task list, search query, status & due filters
 *   * dashboard overview data (projects, tasks)
 * - Communicate with Flask REST API using vanilla fetch.
 * - Render Sidebar navigation (Dashboard button + Project list).
 * - Render Dashboard Screen:
 *   * 4-metric Summary Strip (Projects, Open tasks, Due soon, Overdue)
 *   * Needs Attention list (Overdue and Due Soon tasks only, sorted by urgency)
 *   * Projects overview (open task count, total count, deadline alerts)
 * - Render Project Workspace Screen (Kanban default view, List alternative).
 * - Support optional Task Due Date (YYYY-MM-DD) with local calendar date math.
 * - Filter and Search tasks within project without mutating canonical data.
 * - Handle native HTML5 drag-and-drop for task statuses with optimistic updates and error rollback.
 * - Provide modals for renaming, editing, and deletion confirmations.
 * - Guard against async race conditions across screen switching and project loading.
 * - Safely escape and render all user content using textContent to prevent XSS.
 */

// =====================================================================
// 1. APPLICATION STATE
// =====================================================================
const state = {
  currentUser: null,
  
  // High-level screen: "dashboard" | "project" (Dashboard is default landing screen)
  screen: "dashboard",
  
  // Projects collection owned by current user
  projects: [],
  selectedProjectId: null,
  
  // Tasks belonging to currently selected project
  tasks: [],
  
  // Project workspace view mode: "kanban" (default) | "list"
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

  // Canvas view layout, positions and dependencies state
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

// Sequence counters to reject stale async responses on rapid screen/project navigation
let currentTaskFetchSeq = 0;
let currentDashboardFetchSeq = 0;
let currentMembersFetchSeq = 0;
let currentCommentsFetchSeq = 0;
let currentCanvasFetchSeq = 0;

// Allowed task statuses in exact progression order
const STATUSES = ["Todo", "Doing", "Review", "Done"];

// Canvas zoom configuration constants
const CANVAS_MIN_ZOOM = 0.5;
const CANVAS_MAX_ZOOM = 2.0;
const CANVAS_ZOOM_STEP = 0.1;

// Periodic polling interval for lightweight multi-user synchronization (~5 seconds)
const SYNC_POLL_INTERVAL = 5000;

// =====================================================================
// 2. API HELPERS
// =====================================================================
const api = {
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
// 3. NOTIFICATION / TOAST FEEDBACK
// =====================================================================
function showToast(message, type = "info") {
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
// 4. DATE & DUE STATUS HELPERS (Shared Single Source of Truth)
// =====================================================================

/**
 * Parses a 'YYYY-MM-DD' date string as local calendar date components.
 * Prevents browser UTC timezone off-by-one shifts.
 */
function parseLocalDate(dateStr) {
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
 * Returns:
 *   diffDays < 0   => Past date (overdue if not done)
 *   diffDays === 0 => Today
 *   diffDays === 1 => Tomorrow
 *   diffDays > 0   => Future date
 */
function getDaysDiffFromToday(dateStr) {
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
function getTaskDueState(task) {
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
function renderDueBadgeElement(task, isCompact = false) {
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
// 5. DASHBOARD DERIVATIONS & ACTIONS
// =====================================================================

/**
 * Derives the 4-item summary strip counts from raw dashboard data.
 */
function buildDashboardSummary(projects, tasks) {
  const totalProjects = projects.length;
  const openTasks = tasks.filter(t => t.status !== "Done").length;
  const dueSoonTasks = tasks.filter(t => t.status !== "Done" && getTaskDueState(t).type === "due-soon").length;
  const overdueTasks = tasks.filter(t => t.status !== "Done" && getTaskDueState(t).type === "overdue").length;

  return {
    totalProjects,
    openTasks,
    dueSoonTasks,
    overdueTasks
  };
}

/**
 * Extracts and sorts tasks needing urgent attention (Overdue & Due Soon only).
 * Sort order:
 *   1. Overdue tasks (earliest deadline first)
 *   2. Due soon tasks (earliest deadline first)
 */
function getAttentionTasks(tasks) {
  const attentionList = tasks.filter(task => {
    if (task.status === "Done") return false;
    if (!task.due_date || !task.due_date.trim()) return false;
    const dueState = getTaskDueState(task);
    return dueState.type === "overdue" || dueState.type === "due-soon";
  });

  // Sort logically: Overdue before Due Soon, and earliest date first
  attentionList.sort((a, b) => {
    const stateA = getTaskDueState(a);
    const stateB = getTaskDueState(b);

    // Overdue (diffDays < 0) comes before Due Soon (diffDays >= 0)
    if (stateA.type === "overdue" && stateB.type !== "overdue") return -1;
    if (stateA.type !== "overdue" && stateB.type === "overdue") return 1;

    // Within same category, sort by diffDays ascending (most past / nearest first)
    if (stateA.diffDays !== stateB.diffDays) {
      return stateA.diffDays - stateB.diffDays;
    }

    return a.id - b.id;
  });

  return attentionList;
}

/**
 * Derives per-project summary metrics for the Projects section on Dashboard.
 * Preserves the exact project ordering used by the sidebar.
 */
function buildProjectSummaries(projects, tasks) {
  return projects.map(project => {
    const pTasks = tasks.filter(t => t.project_id === project.id);
    const total = pTasks.length;
    const open = pTasks.filter(t => t.status !== "Done").length;
    const overdue = pTasks.filter(t => t.status !== "Done" && getTaskDueState(t).type === "overdue").length;
    const dueSoon = pTasks.filter(t => t.status !== "Done" && getTaskDueState(t).type === "due-soon").length;

    return {
      project,
      total,
      open,
      overdue,
      dueSoon
    };
  });
}

/**
 * Opens the Dashboard screen and fetches fresh dashboard data.
 */
async function openDashboard() {
  stopProjectSync();
  state.screen = "dashboard";
  state.selectedProjectId = null;
  sessionStorage.removeItem("workroom_selected_project_id");

  hideInlineProjectForm();
  hideInlineTaskBox();
  state.canvas.pendingCreatePosition = null;
  state.canvas.isPanning = false;
  state.canvas.spacePressed = false;
  state.canvas.justPanned = false;
  state.canvas.justConnected = false;
  cancelDependencyConnection();
  state.canvas.selectedDependency = null;
  resetFilters();
  renderSidebar();
  renderScreen();

  await loadDashboard();
}

/**
 * Fetches dashboard data from /api/dashboard.
 * Rejects stale async responses if the user navigates away before fetch returns.
 */
async function loadDashboard() {
  const fetchSeq = ++currentDashboardFetchSeq;

  const loadingEl = document.getElementById("dashboard-loading");
  const errorEl = document.getElementById("dashboard-error");
  const contentEl = document.getElementById("dashboard-content");
  const emptyProjectsEl = document.getElementById("dashboard-empty-projects");

  // Show loading indicator only if we have no prior dashboard content rendered
  if (state.dashboard.projects.length === 0 && loadingEl && contentEl) {
    loadingEl.style.display = "block";
    if (errorEl) errorEl.style.display = "none";
    if (contentEl) contentEl.style.display = "none";
    if (emptyProjectsEl) emptyProjectsEl.style.display = "none";
  }

  const res = await api.get("/api/dashboard");

  // Discard stale response if user switched screen while fetch was in flight
  if (fetchSeq !== currentDashboardFetchSeq || state.screen !== "dashboard") {
    return;
  }

  if (loadingEl) loadingEl.style.display = "none";

  if (!res || !res.ok) {
    if (errorEl) errorEl.style.display = "block";
    if (contentEl) contentEl.style.display = "none";
    if (emptyProjectsEl) emptyProjectsEl.style.display = "none";
    return;
  }

  const data = res.data.data || { projects: [], tasks: [] };
  state.dashboard = data;
  state.projects = data.projects || [];

  renderSidebar();
  renderDashboard();
}

/**
 * Renders all dashboard elements (Summary, Needs Attention, Projects overview).
 */
function renderDashboard() {
  const errorEl = document.getElementById("dashboard-error");
  const contentEl = document.getElementById("dashboard-content");
  const emptyProjectsEl = document.getElementById("dashboard-empty-projects");

  if (errorEl) errorEl.style.display = "none";

  const projects = state.dashboard.projects || [];
  const tasks = state.dashboard.tasks || [];

  // Case 1: User owns 0 projects
  if (projects.length === 0) {
    if (emptyProjectsEl) emptyProjectsEl.style.display = "block";
    if (contentEl) contentEl.style.display = "none";
    return;
  }

  if (emptyProjectsEl) emptyProjectsEl.style.display = "none";
  if (contentEl) contentEl.style.display = "block";

  // 1. Render Summary Strip
  const summary = buildDashboardSummary(projects, tasks);
  renderDashboardSummary(summary);

  // 2. Render Needs Attention section
  const attentionTasks = getAttentionTasks(tasks);
  renderAttentionTasks(attentionTasks);

  // 3. Render Projects overview section
  const projectSummaries = buildProjectSummaries(projects, tasks);
  renderDashboardProjects(projectSummaries);
}

/**
 * Updates the 4 compact summary tiles.
 */
function renderDashboardSummary(summary) {
  const elProjects = document.getElementById("summary-projects-count");
  const elOpen = document.getElementById("summary-open-count");
  const elDueSoon = document.getElementById("summary-due-soon-count");
  const elOverdue = document.getElementById("summary-overdue-count");

  const tileDueSoon = document.getElementById("tile-due-soon");
  const tileOverdue = document.getElementById("tile-overdue");

  if (elProjects) elProjects.textContent = summary.totalProjects.toString();
  if (elOpen) elOpen.textContent = summary.openTasks.toString();
  if (elDueSoon) elDueSoon.textContent = summary.dueSoonTasks.toString();
  if (elOverdue) elOverdue.textContent = summary.overdueTasks.toString();

  // Subtle semantic color accents for urgent counts
  if (tileDueSoon) {
    if (summary.dueSoonTasks > 0) {
      tileDueSoon.classList.add("warning");
    } else {
      tileDueSoon.classList.remove("warning");
    }
  }

  if (tileOverdue) {
    if (summary.overdueTasks > 0) {
      tileOverdue.classList.add("danger");
    } else {
      tileOverdue.classList.remove("danger");
    }
  }
}

/**
 * Renders the Needs Attention list (max 8 tasks, with '+ N more' note if exceeded).
 */
function renderAttentionTasks(attentionTasks) {
  const body = document.getElementById("dashboard-attention-body");
  const badge = document.getElementById("attention-badge");
  if (!body) return;

  body.innerHTML = "";

  if (badge) {
    if (attentionTasks.length > 0) {
      badge.textContent = attentionTasks.length.toString();
      badge.style.display = "inline-block";
    } else {
      badge.style.display = "none";
    }
  }

  if (attentionTasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dashboard-panel-empty";
    empty.textContent = "Nothing needs attention right now.";
    body.appendChild(empty);
    return;
  }

  // Display up to 8 items
  const maxDisplay = 8;
  const displayItems = attentionTasks.slice(0, maxDisplay);

  displayItems.forEach(task => {
    const item = document.createElement("div");
    item.className = "attention-item";
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    item.setAttribute("aria-label", `Open project for ${task.title}`);

    // Left info
    const content = document.createElement("div");
    content.className = "attention-item-content";

    const titleEl = document.createElement("div");
    titleEl.className = "attention-title";
    titleEl.textContent = task.title;
    titleEl.title = task.title;
    content.appendChild(titleEl);

    const metaEl = document.createElement("div");
    metaEl.className = "attention-meta";
    let metaText = `${task.project_name || "Project"} • ${task.status}`;
    if (task.assignee_username) {
      metaText += ` • @${task.assignee_username}`;
    }
    metaEl.textContent = metaText;
    content.appendChild(metaEl);

    // Right due badge
    const badgeEl = renderDueBadgeElement(task, false);

    item.appendChild(content);
    if (badgeEl) item.appendChild(badgeEl);

    // Action: click or keyboard Enter opens project
    const handleClick = () => selectProject(task.project_id);
    item.addEventListener("click", handleClick);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    });

    body.appendChild(item);
  });

  // If more than 8 tasks exist, display compact notice
  if (attentionTasks.length > maxDisplay) {
    const remaining = attentionTasks.length - maxDisplay;
    const moreNote = document.createElement("div");
    moreNote.className = "attention-more-note";
    moreNote.textContent = `+ ${remaining} more task${remaining === 1 ? "" : "s"} need attention`;
    body.appendChild(moreNote);
  }
}

/**
 * Renders the Projects overview list on the Dashboard.
 */
function renderDashboardProjects(projectSummaries) {
  const body = document.getElementById("dashboard-projects-body");
  const badge = document.getElementById("projects-overview-badge");
  if (!body) return;

  body.innerHTML = "";

  if (badge) {
    badge.textContent = projectSummaries.length.toString();
  }

  if (projectSummaries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dashboard-panel-empty";
    empty.textContent = "No projects created yet.";
    body.appendChild(empty);
    return;
  }

  projectSummaries.forEach(item => {
    const row = document.createElement("div");
    row.className = "dashboard-project-item";
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.setAttribute("aria-label", `Open project ${item.project.name}`);

    // Left info
    const info = document.createElement("div");
    info.className = "dashboard-project-info";

    const nameEl = document.createElement("div");
    nameEl.className = "dashboard-project-name";
    nameEl.textContent = item.project.name;
    nameEl.title = item.project.name;
    info.appendChild(nameEl);

    const taskCountEl = document.createElement("div");
    taskCountEl.className = "dashboard-project-tasks";
    taskCountEl.textContent = `${item.open} open / ${item.total} task${item.total === 1 ? "" : "s"}`;
    info.appendChild(taskCountEl);

    // Right status
    const statusEl = document.createElement("div");
    statusEl.className = "dashboard-project-status";

    if (item.project.relationship === "member") {
      const joinedTag = document.createElement("span");
      joinedTag.className = "dashboard-status-tag muted";
      joinedTag.textContent = "Joined";
      joinedTag.title = "Joined Project";
      statusEl.appendChild(joinedTag);
    }

    if (item.overdue > 0 || item.dueSoon > 0) {
      if (item.overdue > 0) {
        const tag = document.createElement("span");
        tag.className = "dashboard-status-tag danger";
        tag.textContent = `${item.overdue} overdue`;
        statusEl.appendChild(tag);
      }
      if (item.dueSoon > 0) {
        const tag = document.createElement("span");
        tag.className = "dashboard-status-tag warning";
        tag.textContent = `${item.dueSoon} due soon`;
        statusEl.appendChild(tag);
      }
    } else {
      const clearSpan = document.createElement("span");
      clearSpan.className = "dashboard-status-tag clear";
      clearSpan.textContent = item.total === 0 ? "No tasks" : "All clear";
      statusEl.appendChild(clearSpan);
    }

    row.appendChild(info);
    row.appendChild(statusEl);

    // Action: click or keyboard Enter opens project
    const handleClick = () => selectProject(item.project.id);
    row.addEventListener("click", handleClick);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    });

    body.appendChild(row);
  });
}

// =====================================================================
// 6. DATA EXPORT ACTIONS (CSV & JSON)
// =====================================================================

/**
 * Triggers an in-memory browser file download from an authenticated GET endpoint.
 * Preserves application screen, project selection, filters, and state intact.
 */
async function downloadExport(url, fallbackFilename, errorMessage) {
  try {
    const res = await fetch(url);
    if (res.status === 401) {
      window.location.href = "/";
      return;
    }
    if (!res.ok) {
      showToast(errorMessage, "error");
      return;
    }

    // Parse filename from Content-Disposition header if provided
    let filename = fallbackFilename;
    const disposition = res.headers.get("Content-Disposition");
    if (disposition && disposition.includes("filename=")) {
      const match = disposition.match(/filename="?([^";]+)"?/);
      if (match && match[1]) {
        filename = match[1];
      }
    }

    const blob = await res.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      window.URL.revokeObjectURL(objectUrl);
      a.remove();
    }, 100);
  } catch (err) {
    console.error("Export download error:", err);
    showToast(errorMessage, "error");
  }
}

/**
 * Exports all tasks of a given project as CSV.
 */
async function exportProjectCsv(projectId, projectName) {
  closeProjectMenu();
  closeGlobalContextMenu();
  const id = projectId || state.selectedProjectId;
  if (!id) return;
  const project = state.projects.find(p => p.id === id);
  const name = projectName || (project ? project.name : "project");
  const fallback = `${name.toLowerCase().replace(/\s+/g, "-")}-tasks.csv`;
  await downloadExport(
    `/api/projects/${id}/export.csv`,
    fallback,
    "Could not export project."
  );
}

/**
 * Exports all tasks of the currently selected project as CSV.
 */
async function exportCurrentProjectCsv() {
  await exportProjectCsv(state.selectedProjectId);
}

/**
 * Exports all Workroom projects and tasks owned by user as JSON.
 */
async function exportAllDataJson() {
  closeProjectMenu();
  closeGlobalContextMenu();
  const dateStr = new Date().toISOString().slice(0, 10);
  await downloadExport(
    "/api/export.json",
    `workroom-mini-export-${dateStr}.json`,
    "Could not export Workroom data."
  );
}

// =====================================================================
// 7. LIGHTWEIGHT MULTI-USER SYNCHRONIZATION (HTTP Periodic Polling)
// =====================================================================

/**
 * Halts any active project polling timer and resets synchronization flags.
 */
function stopProjectSync() {
  if (state.sync.timerId) {
    clearTimeout(state.sync.timerId);
    state.sync.timerId = null;
  }
  state.sync.projectId = null;
  state.sync.inFlight = false;
  state.sync.deferred = false;
  state.sync.pendingRevision = null;
  state.sync.pollSeq++;
}

/**
 * Initializes and starts the single non-overlapping polling loop for the specified project.
 */
function startProjectSync(projectId, initialRevision = null) {
  stopProjectSync();
  state.sync.projectId = projectId;
  state.sync.lastRevision = initialRevision;
  state.sync.pollSeq++;
  scheduleNextPoll();
}

/**
 * Schedules the next poll execution using setTimeout to avoid overlapping requests.
 */
function scheduleNextPoll(delay = SYNC_POLL_INTERVAL) {
  if (state.sync.timerId) {
    clearTimeout(state.sync.timerId);
    state.sync.timerId = null;
  }
  if (state.screen !== "project" || !state.selectedProjectId) {
    return;
  }
  if (document.visibilityState === "hidden") {
    return;
  }
  state.sync.timerId = setTimeout(() => {
    pollProjectRevision();
  }, delay);
}

/**
 * Polls the lightweight revision endpoint (/api/projects/<id>/revision).
 * Zero refetch if revision is unchanged.
 */
async function pollProjectRevision() {
  if (state.screen !== "project" || !state.selectedProjectId) return;
  if (document.visibilityState === "hidden") return;
  if (state.sync.inFlight) return;

  const targetProjectId = state.selectedProjectId;
  const currentPollSeq = state.sync.pollSeq;

  state.sync.inFlight = true;

  try {
    const res = await api.request(`/api/projects/${targetProjectId}/revision`, {
      method: "GET",
      silent: true
    });

    // Guard against stale async responses across project or screen changes
    if (
      currentPollSeq !== state.sync.pollSeq ||
      state.screen !== "project" ||
      state.selectedProjectId !== targetProjectId
    ) {
      return;
    }

    if (!res) {
      // Network error / timeout: retry silently on next interval
      return;
    }

    // Access lost: 403 Forbidden (removed by owner) or 404 (project deleted)
    if (res.status === 403 || res.status === 404) {
      await handleProjectAccessLost(res.status === 404 ? "deleted" : "forbidden");
      return;
    }

    if (!res.ok || !res.data || !res.data.ok) {
      return;
    }

    const info = res.data.data;
    const serverRevision = info.revision;

    // Synchronize project name and role if updated remotely
    const projInList = state.projects.find(p => p.id === targetProjectId);
    if (projInList) {
      let metaChanged = false;
      if (projInList.name !== info.name) {
        projInList.name = info.name;
        metaChanged = true;
      }
      if (projInList.relationship !== info.relationship) {
        projInList.relationship = info.relationship;
        metaChanged = true;
      }
      if (metaChanged) {
        renderSidebar();
        renderScreen();
      }
    }

    if (state.sync.lastRevision === null) {
      state.sync.lastRevision = serverRevision;
    } else if (serverRevision !== state.sync.lastRevision) {
      if (state.sync.isDragging || state.canvas.isPanning || state.canvas.isConnecting) {
        // While user is actively dragging a card, panning canvas, or connecting dependencies, defer DOM update
        state.sync.deferred = true;
        state.sync.pendingRevision = serverRevision;
      } else {
        await syncCurrentProject(serverRevision);
      }
    }
  } finally {
    state.sync.inFlight = false;
    scheduleNextPoll();
  }
}

/**
 * Refetches canonical project tasks and participants when the revision counter advances.
 */
async function syncCurrentProject(newRevision) {
  const projectId = state.selectedProjectId;
  if (!projectId || state.screen !== "project") return;

  state.sync.lastRevision = newRevision;

  const fetches = [
    api.request(`/api/projects/${projectId}/tasks`, { method: "GET", silent: true }),
    api.request(`/api/projects/${projectId}/members`, { method: "GET", silent: true })
  ];

  if (state.view === "canvas") {
    fetches.push(api.request(`/api/projects/${projectId}/canvas-positions`, { method: "GET", silent: true }));
    fetches.push(api.request(`/api/projects/${projectId}/dependencies`, { method: "GET", silent: true }));
  }

  const results = await Promise.all(fetches);
  const tasksRes = results[0];
  const membersRes = results[1];
  const canvasRes = state.view === "canvas" ? results[2] : null;
  const depsRes = state.view === "canvas" ? results[3] : null;

  if (state.screen !== "project" || state.selectedProjectId !== projectId) {
    return;
  }

  // Update members
  if (membersRes && membersRes.ok && membersRes.data && membersRes.data.ok) {
    const memData = membersRes.data.data;
    state.projectMembers = memData.members || [];
    populateAssigneeDropdowns();
    populateAssigneeFilterOptions();
    renderMemberList(state.projectMembers);
    if (memData.join_code !== undefined) {
      const codeEl = document.getElementById("project-join-code-display");
      if (codeEl) codeEl.textContent = memData.join_code;
    }
    const headerCountLabel = document.getElementById("project-members-btn-label");
    if (headerCountLabel && projectId === state.selectedProjectId) {
      headerCountLabel.textContent = `Members ${state.projectMembers.length > 0 ? state.projectMembers.length : 1}`;
    }
  }

  // Update canvas positions if in canvas view
  if (canvasRes && canvasRes.ok && canvasRes.data && canvasRes.data.ok) {
    const posList = canvasRes.data.data.positions || [];
    const posMap = {};
    posList.forEach(p => {
      posMap[p.task_id] = { x: p.x, y: p.y };
    });
    state.canvas.positions = posMap;
    state.canvas.loadedProjectId = projectId;
  }

  // Update canvas dependencies if in canvas view
  if (depsRes && depsRes.ok && depsRes.data && depsRes.data.ok) {
    state.canvas.dependencies = depsRes.data.data.dependencies || [];
    if (state.canvas.selectedDependency) {
      const stillExists = state.canvas.dependencies.some(
        d => d.from_task_id === state.canvas.selectedDependency.from_task_id &&
             d.to_task_id === state.canvas.selectedDependency.to_task_id
      );
      if (!stillExists) {
        state.canvas.selectedDependency = null;
      }
    }
  }

  // Update tasks
  if (tasksRes && tasksRes.ok && tasksRes.data && tasksRes.data.ok) {
    const newTasks = tasksRes.data.data || [];
    state.tasks = newTasks;

    if (state.view === "canvas") {
      await initializeMissingCanvasPositions(projectId);
    }
    renderTasks();

    // Check if Edit Task modal is open
    if (state.activeModal === "modal-edit-task" && state.editingTaskId) {
      const currentEditingId = state.editingTaskId;
      const remoteTask = newTasks.find(t => t.id === currentEditingId);

      if (!remoteTask) {
        // Task was deleted remotely
        closeModal("modal-edit-task");
        showToast("This task was deleted in another session.", "info");
      } else {
        // Refresh comments on-demand preserving composer draft
        await refreshTaskCommentsPreservingDraft(currentEditingId);

        // Check if user has unsaved edits in task modal form
        const isDirty = isTaskEditModalDirty();
        if (!isDirty) {
          updateTaskEditModalValues(remoteTask);
          hideTaskEditRemoteNotice();
        } else {
          showTaskEditRemoteNotice();
        }
      }
    }
  }
}

/**
 * Handles graceful recovery when the current user is removed or project is deleted.
 */
async function handleProjectAccessLost(reason) {
  stopProjectSync();
  if (state.activeModal) {
    closeModal(state.activeModal);
  }
  state.selectedProjectId = null;
  sessionStorage.removeItem("workroom_selected_project_id");

  if (reason === "deleted") {
    showToast("This Project no longer exists.", "info");
  } else {
    showToast("You no longer have access to this project.", "error");
  }

  await openDashboard();
  await loadProjects();
}

/**
 * Checks whether user has modified any field in the open Edit Task modal.
 */
function isTaskEditModalDirty() {
  if (!state.taskModalSnapshot) return false;
  const title = (document.getElementById("input-edit-task-title")?.value || "").trim();
  const desc = (document.getElementById("input-edit-task-desc")?.value || "").trim();
  const status = document.getElementById("select-edit-task-status")?.value || "";
  const due = document.getElementById("input-edit-task-due")?.value || "";
  const assignee = document.getElementById("select-edit-task-assignee")?.value || "";

  return (
    title !== state.taskModalSnapshot.title ||
    desc !== state.taskModalSnapshot.description ||
    status !== state.taskModalSnapshot.status ||
    due !== state.taskModalSnapshot.due_date ||
    assignee !== state.taskModalSnapshot.assignee_id
  );
}

/**
 * Populates Edit Task modal with fresh values from remote task.
 */
function updateTaskEditModalValues(remoteTask) {
  const titleInput = document.getElementById("input-edit-task-title");
  const descInput = document.getElementById("input-edit-task-desc");
  const statusSelect = document.getElementById("select-edit-task-status");
  const dueInput = document.getElementById("input-edit-task-due");
  const assigneeSelect = document.getElementById("select-edit-task-assignee");

  if (titleInput) titleInput.value = remoteTask.title || "";
  if (descInput) descInput.value = remoteTask.description || "";
  if (statusSelect) statusSelect.value = remoteTask.status || "Todo";
  if (dueInput) dueInput.value = remoteTask.due_date || "";
  if (assigneeSelect) assigneeSelect.value = remoteTask.assignee_id ? String(remoteTask.assignee_id) : "";

  state.taskModalSnapshot = {
    title: (remoteTask.title || "").trim(),
    description: (remoteTask.description || "").trim(),
    status: remoteTask.status || "Todo",
    due_date: remoteTask.due_date || "",
    assignee_id: remoteTask.assignee_id ? String(remoteTask.assignee_id) : ""
  };
}

function showTaskEditRemoteNotice() {
  const notice = document.getElementById("task-edit-remote-notice");
  if (notice) notice.style.display = "block";
}

function hideTaskEditRemoteNotice() {
  const notice = document.getElementById("task-edit-remote-notice");
  if (notice) notice.style.display = "none";
}

/**
 * Re-fetches task comments while strictly preserving any typed comment in the composer.
 */
async function refreshTaskCommentsPreservingDraft(taskId) {
  const commentInput = document.getElementById("task-comment-input");
  const draft = commentInput ? commentInput.value : "";

  const res = await api.request(`/api/tasks/${taskId}/comments`, { method: "GET", silent: true });
  if (!res || !res.ok || !res.data || !res.data.ok) return;

  if (state.activeModal !== "modal-edit-task" || state.editingTaskId !== taskId) {
    return;
  }

  const comments = res.data.data || [];
  const countEl = document.getElementById("task-comments-count");
  if (countEl) countEl.textContent = comments.length.toString();

  renderCommentsList(comments);

  if (commentInput) {
    commentInput.value = draft;
  }
}

// =====================================================================
// 8. PROJECT ACTIONS & WORKSPACE
// =====================================================================

/**
 * Loads all projects owned by the logged-in user from SQLite.
 */
async function loadProjects() {
  const res = await api.get("/api/projects");
  if (!res || !res.ok) return;

  state.projects = res.data.data || [];
  renderSidebar();
}

/**
 * Selects an existing project and opens Project Workspace.
 */
async function selectProject(projectId) {
  state.screen = "project";
  state.selectedProjectId = projectId;
  sessionStorage.setItem("workroom_selected_project_id", projectId);

  // Reset search and filter conditions on project switch
  resetFilters();
  hideInlineProjectForm();
  hideInlineTaskBox();

  // Reset canvas state on project switch (Section 10, 154)
  state.canvas.positions = {};
  state.canvas.dependencies = [];
  state.canvas.selectedDependency = null;
  state.canvas.pendingDeleteDependency = null;
  cancelDependencyConnection();
  state.canvas.loadedProjectId = null;
  state.canvas.camera = { panX: 0, panY: 0, zoom: 1.0 };
  state.canvas.pendingCreatePosition = null;
  state.canvas.isPanning = false;
  state.canvas.spacePressed = false;
  state.canvas.justPanned = false;
  state.canvas.justConnected = false;
  state.canvas.minimap = { isDraggingViewport: false };
  const minimapEl = document.getElementById("canvas-minimap");
  if (minimapEl) minimapEl.style.display = "none";
  currentCanvasFetchSeq++;

  renderSidebar();
  renderScreen();

  const loadPromises = [
    loadTasks(projectId),
    loadProjectMembers(projectId)
  ];

  if (state.view === "canvas") {
    loadPromises.push(loadCanvasPositions(projectId));
    loadPromises.push(loadCanvasDependencies(projectId));
  }

  await Promise.all(loadPromises);

  const curProj = state.projects.find(p => p.id === projectId);
  const initialRev = (curProj && curProj.revision != null) ? curProj.revision : null;
  startProjectSync(projectId, initialRev);
}

/**
 * Creates a new project and selects it immediately.
 */
async function createProject(name) {
  if (state.isSubmitting) return;
  const trimmed = (name || "").trim();
  if (!trimmed) {
    showToast("Project name cannot be empty.", "error");
    return;
  }

  state.isSubmitting = true;
  const submitBtn = document.getElementById("create-project-btn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating...";
  }

  try {
    const res = await api.post("/api/projects", { name: trimmed });

    if (res && res.ok && res.data.ok) {
      const newProject = res.data.data;
      state.projects.push(newProject);
      hideInlineProjectForm();
      showToast(`Project "${newProject.name}" created.`, "success");

      // Enter the newly created project immediately
      await selectProject(newProject.id);
    } else {
      const errorMsg = res?.data?.error || "Failed to create project.";
      showToast(errorMsg, "error");
    }
  } finally {
    state.isSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create";
    }
  }
}

/**
 * Renames the specified project.
 */
async function renameProject(projectId, newName) {
  if (state.isSubmitting) return;
  const trimmed = (newName || "").trim();
  if (!trimmed) {
    showToast("Project name cannot be empty.", "error");
    return;
  }

  state.isSubmitting = true;
  const saveBtn = document.getElementById("btn-save-project-name");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
  }

  try {
    const res = await api.patch(`/api/projects/${projectId}`, { name: trimmed });

    if (res && res.ok && res.data.ok) {
      if (res.data.project_revision != null) {
        state.sync.lastRevision = res.data.project_revision;
      }
      const updated = res.data.data;
      const idx = state.projects.findIndex(p => p.id === projectId);
      if (idx !== -1) {
        state.projects[idx] = updated;
      }
      closeModal("modal-rename-project");
      renderSidebar();
      renderScreen();
      showToast("Project renamed.", "success");
    } else {
      const errorMsg = res?.data?.error || "Failed to rename project.";
      showToast(errorMsg, "error");
    }
  } finally {
    state.isSubmitting = false;
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
    }
  }
}

/**
 * Permanently deletes a project and cascades tasks.
 */
async function deleteProject(projectId) {
  if (state.isSubmitting) return;
  state.isSubmitting = true;

  const deleteBtn = document.getElementById("btn-confirm-delete-project");
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Deleting...";
  }

  try {
    const res = await api.delete(`/api/projects/${projectId}`);

    if (res && res.ok && res.data.ok) {
      state.projects = state.projects.filter(p => p.id !== projectId);
      closeModal("modal-delete-project");

      // Return to dashboard after project deletion
      await openDashboard();
      showToast("Project permanently deleted.", "info");
    } else {
      const errorMsg = res?.data?.error || "Failed to delete project.";
      showToast(errorMsg, "error");
    }
  } finally {
    state.isSubmitting = false;
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.textContent = "Delete";
    }
  }
}

// =====================================================================
// 7. PROJECT COLLABORATION (Join, Members, Join Code, Member Removal)
// =====================================================================

function isCurrentProjectOwner() {
  if (!state.selectedProjectId) return false;
  const p = state.projects.find(proj => proj.id === state.selectedProjectId);
  return p ? p.relationship === "owner" : false;
}

function openJoinProjectModal() {
  const input = document.getElementById("input-join-code");
  const errEl = document.getElementById("join-project-error");
  if (input) input.value = "";
  if (errEl) {
    errEl.textContent = "";
    errEl.style.display = "none";
  }
  openModal("modal-join-project");
}

function showJoinProjectError(msg) {
  const errEl = document.getElementById("join-project-error");
  if (errEl) {
    errEl.textContent = msg;
    errEl.style.display = "block";
  } else {
    showToast(msg, "error");
  }
}

async function joinProject(joinCode) {
  if (state.isSubmitting) return;
  const cleanCode = (joinCode || "").trim().toUpperCase();
  if (!cleanCode) {
    showJoinProjectError("Join code is required.");
    return;
  }

  state.isSubmitting = true;
  const submitBtn = document.getElementById("btn-submit-join-project");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Joining...";
  }

  try {
    const res = await api.post("/api/projects/join", { join_code: cleanCode });
    if (res && res.ok && res.data.ok) {
      const joinedProject = res.data.data;
      closeModal("modal-join-project");
      showToast(`Joined project "${joinedProject.name}".`, "success");
      await loadProjects();
      await selectProject(joinedProject.id);
    } else {
      const errorMsg = res?.data?.error || "Could not join project.";
      showJoinProjectError(errorMsg);
    }
  } finally {
    state.isSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Join Project";
    }
  }
}

async function openMembersModal(projectId) {
  const targetId = projectId || state.selectedProjectId;
  if (!targetId) return;

  closeProjectMenu();
  openModal("modal-project-members");
  await loadProjectMembers(targetId);
}

async function loadProjectMembers(projectId) {
  const seq = ++currentMembersFetchSeq;
  const listEl = document.getElementById("project-members-list");
  const headingEl = document.getElementById("members-list-count-heading");
  const inviteSection = document.getElementById("members-invite-section");
  const joinCodeEl = document.getElementById("member-modal-join-code");

  if (listEl) {
    listEl.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 13px;">Loading members...</div>';
  }

  const res = await api.get(`/api/projects/${projectId}/members`);
  if (seq !== currentMembersFetchSeq) return;

  if (!res || !res.ok) {
    if (res && res.status === 403) {
      closeModal("modal-project-members");
      showToast("You no longer have access to this Project.", "error");
      await openDashboard();
      await loadProjects();
      return;
    }
    const errorMsg = res?.data?.error || "Could not load members.";
    showToast(errorMsg, "error");
    closeModal("modal-project-members");
    return;
  }

  const data = res.data.data || {};
  const members = data.members || [];
  state.projectMembers = members;
  populateAssigneeDropdowns();
  populateAssigneeFilterOptions();

  const currentProject = state.projects.find(p => p.id === projectId);
  const isOwner = currentProject ? currentProject.relationship === "owner" : false;

  // Invite section & Join Code (Owner only)
  if (inviteSection) {
    if (isOwner && data.join_code) {
      inviteSection.style.display = "block";
      if (joinCodeEl) joinCodeEl.textContent = data.join_code;
    } else {
      inviteSection.style.display = "none";
      if (joinCodeEl) joinCodeEl.textContent = "----";
    }
  }

  // Heading
  if (headingEl) {
    headingEl.textContent = `Members (${members.length})`;
  }

  // Update Project Header button label if on screen
  const headerCountLabel = document.getElementById("project-members-btn-label");
  if (headerCountLabel && projectId === state.selectedProjectId) {
    headerCountLabel.textContent = `Members (${members.length})`;
  }

  // Render Member rows
  if (!listEl) return;
  listEl.innerHTML = "";

  members.forEach(member => {
    const row = document.createElement("div");
    row.className = "member-row";

    // Member Info: username + role badge
    const info = document.createElement("div");
    info.className = "member-info";

    const nameSpan = document.createElement("span");
    nameSpan.className = "member-username";
    nameSpan.textContent = member.username;

    const roleBadge = document.createElement("span");
    roleBadge.className = `member-role-badge ${member.relationship}`;
    roleBadge.textContent = member.relationship === "owner" ? "Owner" : "Member";

    info.appendChild(nameSpan);
    info.appendChild(roleBadge);
    row.appendChild(info);

    // Member Actions (Owner can remove non-owner members)
    if (isOwner && member.relationship !== "owner") {
      const actions = document.createElement("div");
      actions.className = "member-actions";

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn-remove-member";
      removeBtn.textContent = "Remove";
      removeBtn.setAttribute("aria-label", `Remove ${member.username}`);
      removeBtn.title = `Remove ${member.username} from this project`;

      removeBtn.addEventListener("click", () => {
        openConfirmRemoveMemberModal(member.id, member.username);
      });

      actions.appendChild(removeBtn);
      row.appendChild(actions);
    }

    listEl.appendChild(row);
  });
}

async function copyJoinCode() {
  const codeEl = document.getElementById("member-modal-join-code");
  const btnText = document.getElementById("copy-join-code-btn-text");
  if (!codeEl) return;

  const code = codeEl.textContent.trim();
  if (!code || code === "----") return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      const tempInput = document.createElement("input");
      tempInput.value = code;
      document.body.appendChild(tempInput);
      tempInput.select();
      document.execCommand("copy");
      document.body.removeChild(tempInput);
    }

    if (btnText) {
      const orig = btnText.textContent;
      btnText.textContent = "Copied!";
      setTimeout(() => { btnText.textContent = orig; }, 1500);
    }
  } catch (err) {
    showToast("Failed to copy code.", "error");
  }
}

function openConfirmRegenerateCodeModal() {
  openModal("modal-confirm-regenerate-code");
}

async function regenerateJoinCode() {
  if (!state.selectedProjectId) return;
  if (state.isSubmitting) return;

  state.isSubmitting = true;
  const btn = document.getElementById("btn-confirm-regenerate-code");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Regenerating...";
  }

  try {
    const res = await api.post(`/api/projects/${state.selectedProjectId}/join-code/regenerate`);
    if (res && res.ok && res.data.ok) {
      if (res.data.project_revision != null) {
        state.sync.lastRevision = res.data.project_revision;
      }
      const newCode = res.data.data.join_code;
      const joinCodeEl = document.getElementById("member-modal-join-code");
      if (joinCodeEl) joinCodeEl.textContent = newCode;

      closeModal("modal-confirm-regenerate-code");
      showToast("Join code regenerated.", "success");
    } else {
      const errorMsg = res?.data?.error || "Failed to regenerate join code.";
      showToast(errorMsg, "error");
    }
  } finally {
    state.isSubmitting = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Regenerate";
    }
  }
}

function openConfirmRemoveMemberModal(userId, username) {
  state.pendingRemoveMember = { userId, username };
  const promptEl = document.getElementById("remove-member-prompt");
  const currentProject = state.projects.find(p => p.id === state.selectedProjectId);
  const projName = currentProject ? currentProject.name : "this project";

  if (promptEl) {
    promptEl.textContent = `Remove ${username} from “${projName}”?`;
  }
  openModal("modal-confirm-remove-member");
}

async function removeMember() {
  if (!state.pendingRemoveMember || !state.selectedProjectId) return;
  if (state.isSubmitting) return;

  state.isSubmitting = true;
  const btn = document.getElementById("btn-confirm-remove-member");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Removing...";
  }

  try {
    const res = await api.delete(`/api/projects/${state.selectedProjectId}/members/${state.pendingRemoveMember.userId}`);
    if (res && res.ok) {
      if (res.data && res.data.project_revision != null) {
        state.sync.lastRevision = res.data.project_revision;
      }
      const removedUser = state.pendingRemoveMember.username;
      closeModal("modal-confirm-remove-member");
      state.pendingRemoveMember = null;
      showToast(`Removed ${removedUser} from project.`, "info");
      await loadProjectMembers(state.selectedProjectId);
      await loadTasks(state.selectedProjectId);
    } else {
      const errorMsg = res?.data?.error || "Failed to remove member.";
      showToast(errorMsg, "error");
    }
  } finally {
    state.isSubmitting = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Remove";
    }
  }
}

/**
 * Populates Assignee select options in both Fast-Add form and Edit Task modal
 * with active project participants (Owner and Members).
 */
function populateAssigneeDropdowns() {
  const fastSelect = document.getElementById("fast-task-assignee");
  const editSelect = document.getElementById("select-edit-task-assignee");

  const fillSelect = (selectEl, selectedVal) => {
    if (!selectEl) return;
    const currentVal = selectedVal !== undefined ? selectedVal : selectEl.value;
    selectEl.innerHTML = "";

    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "Unassigned";
    selectEl.appendChild(defaultOpt);

    state.projectMembers.forEach(m => {
      const opt = document.createElement("option");
      opt.value = String(m.id);
      const roleLabel = m.relationship === "owner" ? " (Owner)" : "";
      opt.textContent = `${m.username}${roleLabel}`;
      if (currentVal && String(currentVal) === String(m.id)) {
        opt.selected = true;
      }
      selectEl.appendChild(opt);
    });
  };

  if (fastSelect) {
    fillSelect(fastSelect, fastSelect.value);
  }

  if (editSelect) {
    let currentAssigneeId = "";
    if (state.editingTaskId) {
      const task = state.tasks.find(t => t.id === state.editingTaskId);
      if (task && task.assignee_id) currentAssigneeId = String(task.assignee_id);
    }
    fillSelect(editSelect, currentAssigneeId);
  }
}

// =====================================================================
// 8. TASK ACTIONS (Project Workspace)
// =====================================================================

/**
 * Loads tasks for the active project.
 * Uses sequence tracking to prevent async race conditions on rapid navigation.
 */
async function loadTasks(projectId) {
  const fetchSeq = ++currentTaskFetchSeq;

  const res = await api.get(`/api/projects/${projectId}/tasks`);

  // Discard stale response if user switched screen or project while fetch was in flight
  if (fetchSeq !== currentTaskFetchSeq || state.screen !== "project" || state.selectedProjectId !== projectId) {
    return;
  }

  if (!res || !res.ok) {
    if (res && res.status === 403) {
      showToast("You no longer have access to this Project.", "error");
      await openDashboard();
      await loadProjects();
      return;
    }
    if (res && res.status === 404) {
      showToast("Project not found.", "error");
      await openDashboard();
      await loadProjects();
      return;
    }
    state.tasks = [];
  } else {
    state.tasks = res.data.data || [];
  }
  renderTasks();
}

/**
 * Quickly creates a new task in the selected project with optional description and due date.
 */
async function createTask(title, description = "", dueDate = null, assigneeId = null) {
  if (!state.selectedProjectId) return;
  if (state.isSubmitting) return;

  const trimmedTitle = (title || "").trim();
  if (!trimmedTitle) {
    showToast("Task title cannot be empty.", "error");
    const titleInput = document.getElementById("fast-task-title");
    if (titleInput) titleInput.focus();
    return;
  }

  const trimmedDesc = (description || "").trim();
  const cleanDueDate = (dueDate && typeof dueDate === "string" && dueDate.trim()) ? dueDate.trim() : null;
  const cleanAssigneeId = (assigneeId !== null && assigneeId !== undefined && assigneeId !== "") ? parseInt(assigneeId, 10) : null;

  state.isSubmitting = true;
  const submitBtn = document.getElementById("fast-task-submit-btn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating...";
  }

  try {
    const res = await api.post(`/api/projects/${state.selectedProjectId}/tasks`, {
      title: trimmedTitle,
      description: trimmedDesc,
      status: "Todo",
      due_date: cleanDueDate,
      assignee_id: cleanAssigneeId
    });

    if (res && res.ok && res.data.ok) {
      if (res.data.project_revision != null) {
        state.sync.lastRevision = res.data.project_revision;
      }
      const newTask = res.data.data;
      state.tasks.push(newTask);

      if (state.view === "canvas") {
        const chosenPos = state.canvas.pendingCreatePosition
          ? { x: state.canvas.pendingCreatePosition.x, y: state.canvas.pendingCreatePosition.y }
          : getNextDefaultCanvasPosition();
        state.canvas.pendingCreatePosition = null;

        state.canvas.positions[newTask.id] = chosenPos;
        const curProjId = state.selectedProjectId;
        api.request(`/api/projects/${curProjId}/canvas-positions`, {
          method: "PUT",
          body: JSON.stringify({
            positions: [{ task_id: newTask.id, x: chosenPos.x, y: chosenPos.y }]
          }),
          silent: true
        }).then(posRes => {
          if (posRes && posRes.ok && posRes.data && posRes.data.ok) {
            if (posRes.data.project_revision != null) {
              state.sync.lastRevision = posRes.data.project_revision;
            }
          } else {
            showToast("Task created, but its canvas position could not be saved.", "warning");
          }
        }).catch(() => {
          showToast("Task created, but its canvas position could not be saved.", "warning");
        });
      }

      renderTasks();

      // Clear inputs and keep focus on title for rapid consecutive additions
      const titleInput = document.getElementById("fast-task-title");
      const descInput = document.getElementById("fast-task-description");
      const dueInput = document.getElementById("fast-task-due-date");
      const assigneeInput = document.getElementById("fast-task-assignee");

      if (titleInput) {
        titleInput.value = "";
        titleInput.focus();
      }
      if (descInput) {
        descInput.value = "";
      }
      if (dueInput) {
        dueInput.value = "";
      }
      if (assigneeInput) {
        assigneeInput.value = "";
      }
    } else {
      if (res && res.status === 403) {
        showToast("You no longer have access to this Project.", "error");
        await openDashboard();
        await loadProjects();
        return;
      }
      const errorMsg = res?.data?.error || "Failed to create task.";
      showToast(errorMsg, "error");
    }
  } finally {
    state.isSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create Task";
    }
  }
}

/**
 * Updates task title, description, status, and/or due_date.
 */
async function updateTask(taskId, updates) {
  if (state.isSubmitting) return;
  state.isSubmitting = true;

  const saveBtn = document.getElementById("btn-save-task");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
  }

  try {
    const res = await api.patch(`/api/tasks/${taskId}`, updates);

    if (res && res.ok && res.data.ok) {
      if (res.data.project_revision != null) {
        state.sync.lastRevision = res.data.project_revision;
      }
      const updated = res.data.data;
      const idx = state.tasks.findIndex(t => t.id === taskId);
      if (idx !== -1) {
        state.tasks[idx] = updated;
      }
      closeModal("modal-edit-task");
      renderTasks();
    } else {
      if (res && res.status === 403) {
        closeModal("modal-edit-task");
        showToast("You no longer have access to this Project.", "error");
        await openDashboard();
        await loadProjects();
        return;
      }
      const errorMsg = res?.data?.error || "Failed to update task.";
      showToast(errorMsg, "error");
    }
  } finally {
    state.isSubmitting = false;
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
    }
  }
}

/**
 * Optimistically updates task status for drag-and-drop or select change.
 * Rolls back to previous status if backend persistence fails.
 */
async function updateTaskStatus(taskId, newStatus) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || task.status === newStatus) return;

  const previousStatus = task.status;

  // 1. Optimistic UI update
  task.status = newStatus;
  renderTasks();

  // 2. Persist to SQLite backend
  const res = await api.patch(`/api/tasks/${taskId}`, { status: newStatus });

  // 3. Rollback on failure
  if (!res || !res.ok || !res.data.ok) {
    task.status = previousStatus;
    renderTasks();
    if (res && res.status === 403) {
      showToast("You no longer have access to this Project.", "error");
      await openDashboard();
      await loadProjects();
      return;
    }
    showToast("Failed to update status. Reverted change.", "error");
  } else if (res.data && res.data.project_revision != null) {
    state.sync.lastRevision = res.data.project_revision;
  }
}

/**
 * Permanently deletes a task.
 */
async function deleteTask(taskId) {
  if (state.isSubmitting) return;
  state.isSubmitting = true;

  const deleteBtn = document.getElementById("btn-confirm-delete-task");
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Deleting...";
  }

  try {
    const res = await api.delete(`/api/tasks/${taskId}`);

    if (res && res.ok && res.data.ok) {
      if (res.data.project_revision != null) {
        state.sync.lastRevision = res.data.project_revision;
      }
      state.tasks = state.tasks.filter(t => t.id !== taskId);
      if (state.canvas.positions[taskId]) {
        delete state.canvas.positions[taskId];
      }
      state.canvas.dependencies = state.canvas.dependencies.filter(
        d => d.from_task_id !== taskId && d.to_task_id !== taskId
      );
      if (
        state.canvas.selectedDependency &&
        (state.canvas.selectedDependency.from_task_id === taskId || state.canvas.selectedDependency.to_task_id === taskId)
      ) {
        state.canvas.selectedDependency = null;
      }
      closeModal("modal-delete-task");
      renderTasks();
      showToast("Task deleted.", "info");
    } else {
      if (res && res.status === 403) {
        closeModal("modal-delete-task");
        showToast("You no longer have access to this Project.", "error");
        await openDashboard();
        await loadProjects();
        return;
      }
      const errorMsg = res?.data?.error || "Failed to delete task.";
      showToast(errorMsg, "error");
    }
  } finally {
    state.isSubmitting = false;
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.textContent = "Delete";
    }
  }
}

// =====================================================================
// 8. PROJECT TASK SEARCH & FILTER LOGIC
// =====================================================================

/**
 * Helper to determine if a task matches the current assignee filter.
 * Compares strictly by user ID, never by username string (Section 7, 20).
 */
function matchesAssigneeFilter(task) {
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
 * without mutating canonical state.tasks (Section 17, 18, 19).
 */
function getVisibleTasks() {
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

/**
 * Populates Assignee Filter options in the toolbar dropdown with active project participants (Section 8, 9, 10, 58, 96).
 * Preserves selection if valid, or safely resets to "all" if previously selected participant was removed.
 */
function populateAssigneeFilterOptions() {
  const selectEl = document.getElementById("filter-assignee");
  if (!selectEl) return;

  const currentProj = state.projects.find(p => p.id === state.selectedProjectId);
  const participantMap = new Map();

  // Ensure Owner is included even if projectMembers list is still loading (Section 10)
  if (currentProj && currentProj.user_id && currentProj.owner_username) {
    participantMap.set(currentProj.user_id, {
      id: currentProj.user_id,
      username: currentProj.owner_username,
      relationship: "owner"
    });
  }

  (state.projectMembers || []).forEach(m => {
    if (m && m.id != null) {
      participantMap.set(m.id, m);
    }
  });

  // Validate current filter selection: if selected member is no longer a project participant, reset to "all" (Section 45, 48, 114)
  if (state.assigneeFilter && state.assigneeFilter !== "all" && state.assigneeFilter !== "me" && state.assigneeFilter !== "unassigned") {
    let filterUserId = state.assigneeFilter;
    if (typeof filterUserId === "string" && filterUserId.startsWith("user:")) {
      filterUserId = parseInt(filterUserId.substring(5), 10);
    } else {
      filterUserId = parseInt(filterUserId, 10);
    }
    if (!participantMap.has(filterUserId)) {
      state.assigneeFilter = "all";
    }
  }

  selectEl.innerHTML = "";

  // 1. All assignees
  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "All assignees";
  selectEl.appendChild(optAll);

  // 2. My tasks
  const optMe = document.createElement("option");
  optMe.value = "me";
  optMe.textContent = "My tasks";
  selectEl.appendChild(optMe);

  // 3. Unassigned
  const optUnassigned = document.createElement("option");
  optUnassigned.value = "unassigned";
  optUnassigned.textContent = "Unassigned";
  selectEl.appendChild(optUnassigned);

  // Divider + Participants
  if (participantMap.size > 0) {
    const optDivider = document.createElement("option");
    optDivider.disabled = true;
    optDivider.textContent = "──────────";
    selectEl.appendChild(optDivider);

    participantMap.forEach(participant => {
      const opt = document.createElement("option");
      opt.value = `user:${participant.id}`;
      opt.textContent = participant.username;
      selectEl.appendChild(opt);
    });
  }

  updateFilterControlsUI();
}

/**
 * Synchronizes project search & filter controls in the toolbar with state.
 */
function updateFilterControlsUI() {
  const searchInput = document.getElementById("task-search-input");
  const searchClearBtn = document.getElementById("task-search-clear");
  const filterStatusSelect = document.getElementById("filter-status");
  const filterDueSelect = document.getElementById("filter-due");
  const filterAssigneeSelect = document.getElementById("filter-assignee");
  const myTasksBtn = document.getElementById("btn-my-tasks");
  const clearFiltersBtn = document.getElementById("btn-clear-filters");

  if (searchInput && searchInput.value !== state.searchQuery) {
    searchInput.value = state.searchQuery;
  }
  if (searchClearBtn) {
    searchClearBtn.style.display = state.searchQuery.trim() ? "block" : "none";
  }
  if (filterStatusSelect && filterStatusSelect.value !== state.statusFilter) {
    filterStatusSelect.value = state.statusFilter;
  }
  if (filterDueSelect && filterDueSelect.value !== state.dueFilter) {
    filterDueSelect.value = state.dueFilter;
  }
  if (filterAssigneeSelect) {
    let expectedVal = state.assigneeFilter || "all";
    if (typeof expectedVal === "number") {
      expectedVal = `user:${expectedVal}`;
    }
    if (filterAssigneeSelect.value !== expectedVal) {
      filterAssigneeSelect.value = expectedVal;
    }
  }

  const isMyTasksActive = state.assigneeFilter === "me";
  if (myTasksBtn) {
    myTasksBtn.classList.toggle("active", isMyTasksActive);
    myTasksBtn.setAttribute("aria-pressed", isMyTasksActive ? "true" : "false");
  }

  const hasActiveFilters = (
    (state.searchQuery || "").trim() !== "" ||
    state.statusFilter !== "all" ||
    state.dueFilter !== "all" ||
    (state.assigneeFilter !== "all" && state.assigneeFilter !== "")
  );

  if (clearFiltersBtn) {
    clearFiltersBtn.style.display = hasActiveFilters ? "inline-flex" : "none";
  }
}

/**
 * Clears active project search and filter conditions (Section 42).
 */
function resetFilters() {
  state.searchQuery = "";
  state.statusFilter = "all";
  state.dueFilter = "all";
  state.assigneeFilter = "all";
  cancelDependencyConnection();
  updateFilterControlsUI();
}

// =====================================================================
// 9. VIEW SWITCHER (Kanban / List / Canvas in Project Workspace)
// =====================================================================

async function switchView(viewName) {
  if (viewName !== "list" && viewName !== "kanban" && viewName !== "canvas") return;

  state.view = viewName;
  sessionStorage.setItem("workroom_view", viewName);

  const tabList = document.getElementById("view-tab-list");
  const tabKanban = document.getElementById("view-tab-kanban");
  const tabCanvas = document.getElementById("view-tab-canvas");
  const listView = document.getElementById("list-view-container");
  const kanbanView = document.getElementById("kanban-view-container");
  const canvasView = document.getElementById("canvas-view-container");
  const tasksViewport = document.getElementById("tasks-viewport");

  if (tabKanban) {
    tabKanban.classList.toggle("active", viewName === "kanban");
    tabKanban.setAttribute("aria-checked", String(viewName === "kanban"));
  }
  if (tabList) {
    tabList.classList.toggle("active", viewName === "list");
    tabList.setAttribute("aria-checked", String(viewName === "list"));
  }
  if (tabCanvas) {
    tabCanvas.classList.toggle("active", viewName === "canvas");
    tabCanvas.setAttribute("aria-checked", String(viewName === "canvas"));
  }

  if (tasksViewport) {
    tasksViewport.classList.toggle("canvas-mode", viewName === "canvas");
  }

  if (kanbanView) kanbanView.style.display = viewName === "kanban" ? "block" : "none";
  if (listView) listView.style.display = viewName === "list" ? "block" : "none";
  if (canvasView) {
    canvasView.style.display = viewName === "canvas" ? "block" : "none";
    if (viewName === "canvas") {
      applyCanvasTransform();
    }
  }

  if (viewName !== "canvas") {
    cancelDependencyConnection();
    state.canvas.selectedDependency = null;
    const minimapEl = document.getElementById("canvas-minimap");
    if (minimapEl) minimapEl.style.display = "none";
  }

  if (viewName === "canvas" && state.selectedProjectId) {
    if (state.canvas.loadedProjectId !== state.selectedProjectId) {
      await Promise.all([
        loadCanvasPositions(state.selectedProjectId),
        loadCanvasDependencies(state.selectedProjectId)
      ]);
    }
  }

  renderTasks();
}

// =====================================================================
// 10. DRAG AND DROP (Native HTML5)
// =====================================================================

let draggedTaskId = null;

function setupDragAndDrop() {
  const columns = document.querySelectorAll(".kanban-column");

  columns.forEach(column => {
    const cardList = column.querySelector(".kanban-card-list");
    const status = column.getAttribute("data-status");

    column.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (cardList) cardList.classList.add("drag-over");
    });

    column.addEventListener("dragleave", (e) => {
      if (!column.contains(e.relatedTarget)) {
        if (cardList) cardList.classList.remove("drag-over");
      }
    });

    column.addEventListener("drop", async (e) => {
      e.preventDefault();
      if (cardList) cardList.classList.remove("drag-over");

      const taskIdStr = e.dataTransfer.getData("text/plain") || (draggedTaskId ? draggedTaskId.toString() : null);
      const taskId = parseInt(taskIdStr, 10);

      if (taskId && status && STATUSES.includes(status)) {
        await updateTaskStatus(taskId, status);
      }
    });
  });
}

function handleCardDragStart(e, taskId) {
  state.sync.isDragging = true;
  draggedTaskId = taskId;
  e.dataTransfer.setData("text/plain", taskId.toString());
  e.dataTransfer.effectAllowed = "move";
  e.currentTarget.classList.add("dragging");
}

function handleCardDragEnd(e) {
  state.sync.isDragging = false;
  draggedTaskId = null;
  e.currentTarget.classList.remove("dragging");
  document.querySelectorAll(".kanban-card-list").forEach(col => {
    col.classList.remove("drag-over");
  });

  // If a revision update arrived while dragging, apply it now
  if (state.sync.deferred) {
    state.sync.deferred = false;
    const pendingRev = state.sync.pendingRevision;
    state.sync.pendingRevision = null;
    if (pendingRev !== null && pendingRev !== undefined) {
      syncCurrentProject(pendingRev);
    }
  }
}

// =====================================================================
// 11. DIALOGS / MODALS
// =====================================================================

function openModal(modalId) {
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

function closeModal(modalId) {
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
    hideTaskEditRemoteNotice();
  }
}

function openRenameProjectModal(projectId) {
  const idToRename = projectId || state.selectedProjectId;
  const project = state.projects.find(p => p.id === idToRename);
  if (!project) return;
  if (project.relationship !== "owner") {
    showToast("Only the project owner can rename this project.", "error");
    return;
  }

  state.selectedProjectId = idToRename;
  const input = document.getElementById("input-rename-project");
  if (input) input.value = project.name;
  closeProjectMenu();
  openModal("modal-rename-project");
}

function openDeleteProjectModal(projectId) {
  const idToDelete = projectId || state.selectedProjectId;
  const project = state.projects.find(p => p.id === idToDelete);
  if (!project) return;
  if (project.relationship !== "owner") {
    showToast("Only the project owner can delete this project.", "error");
    return;
  }

  state.pendingDeleteProjectId = project.id;
  const prompt = document.getElementById("delete-project-prompt");
  if (prompt) prompt.textContent = `Delete “${project.name}”?`;
  closeProjectMenu();
  openModal("modal-delete-project");
}

function openEditTaskModal(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  state.editingTaskId = taskId;
  const titleInput = document.getElementById("input-edit-task-title");
  const descInput = document.getElementById("input-edit-task-desc");
  const statusSelect = document.getElementById("select-edit-task-status");
  const dueInput = document.getElementById("input-edit-task-due");
  const assigneeSelect = document.getElementById("select-edit-task-assignee");

  if (titleInput) titleInput.value = task.title;
  if (descInput) descInput.value = task.description || "";
  if (statusSelect) statusSelect.value = task.status;
  if (dueInput) dueInput.value = task.due_date || "";

  populateAssigneeDropdowns();
  if (assigneeSelect) {
    assigneeSelect.value = task.assignee_id ? String(task.assignee_id) : "";
  }

  // Snapshot for dirty form detection
  state.taskModalSnapshot = {
    title: (task.title || "").trim(),
    description: (task.description || "").trim(),
    status: task.status || "Todo",
    due_date: task.due_date || "",
    assignee_id: task.assignee_id ? String(task.assignee_id) : ""
  };
  hideTaskEditRemoteNotice();

  const commentInput = document.getElementById("task-comment-input");
  if (commentInput) commentInput.value = "";

  openModal("modal-edit-task");

  loadTaskComments(taskId);
}

function openDeleteTaskModal(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  state.pendingDeleteTaskId = taskId;
  const prompt = document.getElementById("delete-task-prompt");
  if (prompt) prompt.textContent = `Delete “${task.title}”?`;
  openModal("modal-delete-task");
}

// Fast Add Task Input Visibility
function showInlineTaskBox() {
  const box = document.getElementById("inline-task-box");
  const titleInput = document.getElementById("fast-task-title");
  if (!box || !titleInput) return;

  box.style.display = "block";
  titleInput.focus();
}

function hideInlineTaskBox() {
  const box = document.getElementById("inline-task-box");
  const titleInput = document.getElementById("fast-task-title");
  const descInput = document.getElementById("fast-task-description");
  const dueInput = document.getElementById("fast-task-due-date");
  const assigneeInput = document.getElementById("fast-task-assignee");

  // Clear any pending canvas creation coordinates when canceling (Section 66, 144)
  state.canvas.pendingCreatePosition = null;

  if (!box) return;

  box.style.display = "none";
  if (titleInput) titleInput.value = "";
  if (descInput) descInput.value = "";
  if (dueInput) dueInput.value = "";
  if (assigneeInput) assigneeInput.value = "";
}

// =====================================================================
// TASK COMMENTS (Load, Render, Post, Delete)
// =====================================================================

async function loadTaskComments(taskId) {
  const seq = ++currentCommentsFetchSeq;
  const listEl = document.getElementById("task-comments-list");
  const countEl = document.getElementById("task-comments-count");

  if (listEl) {
    listEl.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-muted); font-size: 12px;">Loading comments...</div>';
  }

  const res = await api.get(`/api/tasks/${taskId}/comments`);
  if (seq !== currentCommentsFetchSeq) return;

  if (!res || !res.ok) {
    if (listEl) {
      listEl.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--danger); font-size: 12px;">Failed to load comments.</div>';
    }
    return;
  }

  const comments = res.data.data || [];
  if (countEl) countEl.textContent = comments.length.toString();
  renderCommentsList(comments);
}

function renderCommentsList(comments) {
  const listEl = document.getElementById("task-comments-list");
  if (!listEl) return;

  listEl.innerHTML = "";

  if (!comments || comments.length === 0) {
    const emptyHint = document.createElement("p");
    emptyHint.className = "comments-empty-hint";
    emptyHint.textContent = "No comments yet. Leave a note below.";
    listEl.appendChild(emptyHint);
    return;
  }

  comments.forEach(c => {
    const item = document.createElement("div");
    item.className = "comment-item";
    item.setAttribute("role", "listitem");

    const header = document.createElement("div");
    header.className = "comment-item-header";

    const authorWrap = document.createElement("div");
    authorWrap.className = "comment-author-wrap";

    const author = document.createElement("span");
    author.className = "comment-author";
    author.textContent = `@${c.username}`;

    const timestamp = document.createElement("span");
    timestamp.className = "comment-timestamp";
    timestamp.textContent = c.created_at;

    authorWrap.appendChild(author);
    authorWrap.appendChild(timestamp);
    header.appendChild(authorWrap);

    if (c.can_delete) {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "comment-delete-btn";
      delBtn.textContent = "Delete";
      delBtn.title = "Delete comment";
      delBtn.setAttribute("aria-label", `Delete comment by ${c.username}`);
      delBtn.addEventListener("click", () => {
        openDeleteCommentModal(c.id);
      });
      header.appendChild(delBtn);
    }

    const content = document.createElement("div");
    content.className = "comment-content";
    content.textContent = c.content;

    item.appendChild(header);
    item.appendChild(content);
    listEl.appendChild(item);
  });

  listEl.scrollTop = listEl.scrollHeight;
}

async function postTaskComment() {
  if (!state.editingTaskId) return;
  if (state.isSubmitting) return;

  const input = document.getElementById("task-comment-input");
  if (!input) return;

  const content = input.value.trim();
  if (!content) {
    showToast("Comment cannot be empty.", "error");
    input.focus();
    return;
  }

  const submitBtn = document.getElementById("btn-post-comment");
  state.isSubmitting = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Posting...";
  }

  try {
    const res = await api.post(`/api/tasks/${state.editingTaskId}/comments`, { content });
    if (res && res.ok && res.data.ok) {
      if (res.data.project_revision != null) {
        state.sync.lastRevision = res.data.project_revision;
      }
      input.value = "";
      await loadTaskComments(state.editingTaskId);
    } else {
      const errorMsg = res?.data?.error || "Failed to post comment.";
      showToast(errorMsg, "error");
    }
  } finally {
    state.isSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Post Comment";
    }
  }
}

function openDeleteCommentModal(commentId) {
  state.pendingDeleteCommentId = commentId;
  openModal("modal-confirm-delete-comment");
}

async function confirmDeleteComment() {
  if (!state.pendingDeleteCommentId) return;
  if (state.isSubmitting) return;

  state.isSubmitting = true;
  const delBtn = document.getElementById("btn-confirm-delete-comment");
  if (delBtn) {
    delBtn.disabled = true;
    delBtn.textContent = "Deleting...";
  }

  try {
    const res = await api.delete(`/api/comments/${state.pendingDeleteCommentId}`);
    if (res && res.ok) {
      if (res.data && res.data.project_revision != null) {
        state.sync.lastRevision = res.data.project_revision;
      }
      closeModal("modal-confirm-delete-comment");
      state.pendingDeleteCommentId = null;
      showToast("Comment deleted.", "info");
      if (state.editingTaskId) {
        await loadTaskComments(state.editingTaskId);
      }
    } else {
      const errorMsg = res?.data?.error || "Failed to delete comment.";
      showToast(errorMsg, "error");
    }
  } finally {
    state.isSubmitting = false;
    if (delBtn) {
      delBtn.disabled = false;
      delBtn.textContent = "Delete";
    }
  }
}

// Sidebar Inline Project Creator Form Visibility
function showInlineProjectForm() {
  const form = document.getElementById("inline-project-form");
  const input = document.getElementById("new-project-name");
  if (!form || !input) return;

  form.style.display = "block";
  input.value = "";
  input.focus();
}

function hideInlineProjectForm() {
  const form = document.getElementById("inline-project-form");
  const input = document.getElementById("new-project-name");
  if (!form) return;

  form.style.display = "none";
  if (input) input.value = "";
}

// Global Floating Context Menu Logic (for sidebar rows)
let activeContextMenu = null;

function closeGlobalContextMenu() {
  const menu = document.getElementById("global-context-menu");
  if (menu) {
    menu.style.display = "none";
    menu.innerHTML = "";
  }
  activeContextMenu = null;
}

function openSidebarProjectMenu(e, project) {
  e.stopPropagation();
  e.preventDefault();

  const menu = document.getElementById("global-context-menu");
  if (!menu) return;

  if (activeContextMenu && activeContextMenu.projectId === project.id) {
    closeGlobalContextMenu();
    return;
  }

  menu.innerHTML = "";
  activeContextMenu = { projectId: project.id };

  const isOwner = project.relationship === "owner";

  // Rename option (Owner only)
  if (isOwner) {
    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "dropdown-item";
    renameBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 20h9"></path>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
      </svg>
      <span>Rename project</span>
    `;
    renameBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      closeGlobalContextMenu();
      openRenameProjectModal(project.id);
    });
    menu.appendChild(renameBtn);
  }

  // Members option
  const membersBtn = document.createElement("button");
  membersBtn.type = "button";
  membersBtn.className = "dropdown-item";
  membersBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>
    <span>Members</span>
  `;
  membersBtn.addEventListener("click", (evt) => {
    evt.stopPropagation();
    closeGlobalContextMenu();
    openMembersModal(project.id);
  });
  menu.appendChild(membersBtn);

  // Export CSV option
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "dropdown-item";
  exportBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
    <span>Export project (.csv)</span>
  `;
  exportBtn.addEventListener("click", (evt) => {
    evt.stopPropagation();
    closeGlobalContextMenu();
    exportProjectCsv(project.id, project.name);
  });
  menu.appendChild(exportBtn);

  // Delete option (Owner only)
  if (isOwner) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "dropdown-item danger";
    deleteBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
      <span>Delete project</span>
    `;
    deleteBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      closeGlobalContextMenu();
      openDeleteProjectModal(project.id);
    });
    menu.appendChild(deleteBtn);
  }

  // Positioning
  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.display = "flex";
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 180)}px`;
}

// Project Header Dropdown Menu
function toggleProjectMenu() {
  const menu = document.getElementById("project-menu");
  const btn = document.getElementById("project-menu-btn");
  if (!menu || !btn) return;

  const isVisible = menu.style.display === "flex";
  if (!isVisible) {
    closeGlobalContextMenu();
    const isOwner = isCurrentProjectOwner();
    const renameBtn = document.getElementById("menu-rename-project");
    const deleteBtn = document.getElementById("menu-delete-project");
    if (renameBtn) renameBtn.style.display = isOwner ? "flex" : "none";
    if (deleteBtn) deleteBtn.style.display = isOwner ? "flex" : "none";

    menu.style.display = "flex";
    btn.setAttribute("aria-expanded", "true");
  } else {
    menu.style.display = "none";
    btn.setAttribute("aria-expanded", "false");
  }
}

function closeProjectMenu() {
  const menu = document.getElementById("project-menu");
  const btn = document.getElementById("project-menu-btn");
  if (menu) menu.style.display = "none";
  if (btn) btn.setAttribute("aria-expanded", "false");
}

// =====================================================================
// 12. SCREEN & SIDEBAR RENDERING
// =====================================================================

/**
 * Updates high-level screen visibility (Dashboard vs Project Workspace).
 */
function renderScreen() {
  const dashboardWorkspace = document.getElementById("dashboard-workspace");
  const projectWorkspace = document.getElementById("project-workspace");
  const titleEl = document.getElementById("current-project-title");
  const joinedTag = document.getElementById("current-project-joined-tag");
  const membersBtn = document.getElementById("project-members-btn");
  const membersBtnLabel = document.getElementById("project-members-btn-label");

  if (state.screen === "dashboard") {
    if (dashboardWorkspace) dashboardWorkspace.style.display = "flex";
    if (projectWorkspace) projectWorkspace.style.display = "none";
    const minimapEl = document.getElementById("canvas-minimap");
    if (minimapEl) minimapEl.style.display = "none";
  } else {
    if (dashboardWorkspace) dashboardWorkspace.style.display = "none";
    if (projectWorkspace) projectWorkspace.style.display = "flex";

    const currentProject = state.projects.find(p => p.id === state.selectedProjectId);
    if (titleEl && currentProject) {
      titleEl.textContent = currentProject.name;
      titleEl.title = currentProject.name;
    }

    if (joinedTag) {
      joinedTag.style.display = (currentProject && currentProject.relationship === "member") ? "inline-flex" : "none";
    }

    if (membersBtn) {
      membersBtn.style.display = currentProject ? "inline-flex" : "none";
    }

    if (membersBtnLabel) {
      const count = state.projectMembers.length > 0 ? state.projectMembers.length : 1;
      membersBtnLabel.textContent = `Members ${count}`;
    }

    // Ensure active view tab (Kanban or List) is applied
    switchView(state.view);
  }
}

/**
 * Renders the sidebar navigation: Dashboard button and Projects list.
 */
function renderSidebar() {
  const navDashboardBtn = document.getElementById("nav-dashboard-btn");
  const list = document.getElementById("project-list");
  const emptyState = document.getElementById("projects-empty-state");

  // 1. Dashboard Nav Button Selection State
  if (navDashboardBtn) {
    if (state.screen === "dashboard") {
      navDashboardBtn.classList.add("active");
    } else {
      navDashboardBtn.classList.remove("active");
    }
  }

  // 2. Project List Items Selection State
  if (!list || !emptyState) return;

  list.innerHTML = "";

  if (state.projects.length === 0) {
    list.style.display = "none";
    emptyState.style.display = "block";
    return;
  }

  list.style.display = "flex";
  emptyState.style.display = "none";

  state.projects.forEach(project => {
    const isSelected = (state.screen === "project" && project.id === state.selectedProjectId);
    const li = document.createElement("li");
    li.className = `project-item ${isSelected ? "active" : ""}`;
    li.setAttribute("role", "listitem");
    li.tabIndex = 0;

    const nameSpan = document.createElement("span");
    nameSpan.className = "project-item-name";
    nameSpan.textContent = project.name;
    nameSpan.title = project.name;
    li.appendChild(nameSpan);

    if (project.relationship === "member") {
      const tag = document.createElement("span");
      tag.className = "project-tag-joined";
      tag.textContent = "Joined";
      tag.title = "Joined Project";
      li.appendChild(tag);
    }

    // Context menu trigger button (...)
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "project-item-menu-btn";
    menuBtn.title = "Project options";
    menuBtn.setAttribute("aria-label", `Options for ${project.name}`);
    menuBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="12" r="2"></circle>
        <circle cx="19" cy="12" r="2"></circle>
        <circle cx="5" cy="12" r="2"></circle>
      </svg>
    `;
    menuBtn.addEventListener("click", (e) => {
      openSidebarProjectMenu(e, project);
    });
    li.appendChild(menuBtn);

    // Click or Enter selects project
    li.addEventListener("click", (e) => {
      if (e.target.closest(".project-item-menu-btn")) return;
      closeGlobalContextMenu();
      selectProject(project.id);
    });
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        if (e.target.closest(".project-item-menu-btn")) return;
        e.preventDefault();
        closeGlobalContextMenu();
        selectProject(project.id);
      }
    });

    list.appendChild(li);
  });
}

/**
 * Renders tasks within the active Project Workspace.
 */
function renderTasks() {
  if (state.screen !== "project") return;

  const emptyTasks = document.getElementById("tasks-empty-state");
  const filterEmptyTasks = document.getElementById("tasks-filter-empty-state");
  const listView = document.getElementById("list-view-container");
  const kanbanView = document.getElementById("kanban-view-container");
  const canvasView = document.getElementById("canvas-view-container");
  const tasksViewport = document.getElementById("tasks-viewport");
  const canvasViewport = document.getElementById("canvas-viewport");

  // Record scroll positions to prevent jump during sync
  const viewportScroll = tasksViewport ? tasksViewport.scrollTop : 0;
  const canvasScrollLeft = canvasViewport ? canvasViewport.scrollLeft : 0;
  const canvasScrollTop = canvasViewport ? canvasViewport.scrollTop : 0;
  const colScrolls = {};
  STATUSES.forEach(st => {
    const colList = document.getElementById(`cards-${st.toLowerCase()}`);
    if (colList) colScrolls[st] = colList.scrollTop;
  });

  updateFilterControlsUI();

  const hasTasksInProject = state.tasks.length > 0;
  const visibleTasks = getVisibleTasks();

  // View-specific empty states and rendering
  if (state.view === "canvas") {
    if (emptyTasks) emptyTasks.style.display = "none";
    if (filterEmptyTasks) filterEmptyTasks.style.display = "none";
    if (listView) listView.style.display = "none";
    if (kanbanView) kanbanView.style.display = "none";
    if (canvasView) canvasView.style.display = "block";
    renderCanvasView(visibleTasks);
  } else {
    const canvasOverlay = document.getElementById("canvas-empty-overlay");
    if (canvasOverlay) canvasOverlay.style.display = "none";
    if (canvasView) canvasView.style.display = "none";

    // Case 1: Project has no tasks at all
    if (!hasTasksInProject) {
      if (emptyTasks) emptyTasks.style.display = "flex";
      if (filterEmptyTasks) filterEmptyTasks.style.display = "none";
      if (listView) listView.style.display = "none";
      if (kanbanView) kanbanView.style.display = "none";
      return;
    }

    if (emptyTasks) emptyTasks.style.display = "none";

    // Case 2: Project has tasks, but zero match current search or filters
    if (visibleTasks.length === 0) {
      if (filterEmptyTasks) {
        filterEmptyTasks.style.display = "flex";
        const emptySub = filterEmptyTasks.querySelector(".empty-subtitle");
        if (emptySub) {
          if (state.assigneeFilter === "me") {
            emptySub.textContent = "No tasks are currently assigned to you.";
          } else {
            emptySub.textContent = "No tasks match your current search and filter criteria.";
          }
        }
      }
      if (listView) listView.style.display = "none";
      if (kanbanView) kanbanView.style.display = "none";
      return;
    }

    if (filterEmptyTasks) filterEmptyTasks.style.display = "none";

    // Case 3: Render visible tasks in active view
    if (state.view === "kanban") {
      if (kanbanView) kanbanView.style.display = "block";
      if (listView) listView.style.display = "none";
      renderKanbanView(visibleTasks);
    } else if (state.view === "list") {
      if (listView) listView.style.display = "block";
      if (kanbanView) kanbanView.style.display = "none";
      renderListView(visibleTasks);
    }
  }

  // Restore scroll positions
  if (state.view !== "canvas" && tasksViewport && viewportScroll > 0) {
    tasksViewport.scrollTop = viewportScroll;
  }
  if (state.view === "canvas" && canvasViewport && (canvasScrollLeft > 0 || canvasScrollTop > 0)) {
    canvasViewport.scrollLeft = canvasScrollLeft;
    canvasViewport.scrollTop = canvasScrollTop;
  }
  STATUSES.forEach(st => {
    const colList = document.getElementById(`cards-${st.toLowerCase()}`);
    if (colList && colScrolls[st]) {
      colList.scrollTop = colScrolls[st];
    }
  });
}

function renderListView(visibleTasks) {
  const body = document.getElementById("list-tasks-body");
  if (!body) return;

  body.innerHTML = "";

  visibleTasks.forEach(task => {
    const row = document.createElement("div");
    row.className = "task-row";
    row.setAttribute("role", "listitem");

    // 1. Task Title & Description Group
    const titleCol = document.createElement("div");
    titleCol.className = "task-row-title-col";

    const titleSpan = document.createElement("div");
    titleSpan.className = "task-row-title";
    titleSpan.textContent = task.title;
    titleSpan.title = task.title;
    titleCol.appendChild(titleSpan);

    if (task.description && task.description.trim()) {
      const descSpan = document.createElement("div");
      descSpan.className = "task-row-desc";
      descSpan.textContent = task.description.trim();
      descSpan.title = task.description.trim();
      titleCol.appendChild(descSpan);
    }

    // Clicking title column opens edit task modal
    titleCol.addEventListener("click", () => openEditTaskModal(task.id));

    // 2. Assignee Column
    const assigneeCol = document.createElement("div");
    assigneeCol.className = "task-row-assignee";
    if (task.assignee_username) {
      const badge = document.createElement("span");
      badge.className = "assignee-badge";
      badge.textContent = `@${task.assignee_username}`;
      badge.title = `Assigned to ${task.assignee_username}`;
      assigneeCol.appendChild(badge);
    } else {
      const unassigned = document.createElement("span");
      unassigned.className = "assignee-unassigned";
      unassigned.textContent = "—";
      assigneeCol.appendChild(unassigned);
    }

    // 3. Status Dropdown
    const statusCol = document.createElement("div");
    statusCol.className = "task-row-status";

    const select = document.createElement("select");
    select.className = "filter-select";
    select.style.height = "28px";
    select.style.fontSize = "12px";
    select.setAttribute("aria-label", `Status for ${task.title}`);

    STATUSES.forEach(st => {
      const opt = document.createElement("option");
      opt.value = st;
      opt.textContent = st;
      if (st === task.status) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener("change", (e) => {
      updateTaskStatus(task.id, e.target.value);
    });
    statusCol.appendChild(select);

    // 4. Due Date Badge Column
    const dueCol = document.createElement("div");
    dueCol.className = "task-row-due";

    const dueBadge = renderDueBadgeElement(task, false);
    if (dueBadge) {
      dueCol.appendChild(dueBadge);
    } else {
      const noDue = document.createElement("span");
      noDue.className = "no-due-text";
      noDue.textContent = "—";
      dueCol.appendChild(noDue);
    }

    // 5. Actions (Edit, Delete)
    const actionsCol = document.createElement("div");
    actionsCol.className = "task-row-actions";

    // Edit button
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "task-action-btn";
    editBtn.title = "Edit task";
    editBtn.setAttribute("aria-label", `Edit ${task.title}`);
    editBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 20h9"></path>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
      </svg>
    `;
    editBtn.addEventListener("click", () => openEditTaskModal(task.id));

    // Delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "task-action-btn danger";
    deleteBtn.title = "Delete task";
    deleteBtn.setAttribute("aria-label", `Delete ${task.title}`);
    deleteBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    `;
    deleteBtn.addEventListener("click", () => openDeleteTaskModal(task.id));

    actionsCol.appendChild(editBtn);
    actionsCol.appendChild(deleteBtn);

    row.appendChild(titleCol);
    row.appendChild(assigneeCol);
    row.appendChild(statusCol);
    row.appendChild(dueCol);
    row.appendChild(actionsCol);

    body.appendChild(row);
  });
}

function renderKanbanView(visibleTasks) {
  STATUSES.forEach(status => {
    const listEl = document.getElementById(`cards-${status.toLowerCase()}`);
    const badgeEl = document.getElementById(`badge-${status.toLowerCase()}`);
    if (!listEl) return;

    listEl.innerHTML = "";

    const tasksInStatus = visibleTasks.filter(t => t.status === status);
    if (badgeEl) {
      badgeEl.textContent = tasksInStatus.length.toString();
    }

    if (tasksInStatus.length === 0) {
      const emptyNote = document.createElement("div");
      emptyNote.className = "kanban-empty-note";
      emptyNote.textContent = "No tasks";
      listEl.appendChild(emptyNote);
      return;
    }

    tasksInStatus.forEach(task => {
      const card = document.createElement("div");
      card.className = "kanban-card";
      card.setAttribute("draggable", "true");
      card.setAttribute("role", "listitem");
      card.tabIndex = 0;

      // Card Content Wrapper (Title + description + due badge)
      const contentDiv = document.createElement("div");
      contentDiv.className = "kanban-card-content";

      const titleSpan = document.createElement("div");
      titleSpan.className = "kanban-card-title";
      titleSpan.textContent = task.title;
      contentDiv.appendChild(titleSpan);

      if (task.description && task.description.trim()) {
        const descSpan = document.createElement("div");
        descSpan.className = "kanban-card-desc";
        descSpan.textContent = task.description.trim();
        contentDiv.appendChild(descSpan);
      }

      const dueBadge = renderDueBadgeElement(task, true);
      let assigneeBadge = null;
      if (task.assignee_username) {
        assigneeBadge = document.createElement("span");
        assigneeBadge.className = "kanban-assignee-badge";
        assigneeBadge.textContent = `@${task.assignee_username}`;
        assigneeBadge.title = `Assigned to ${task.assignee_username}`;
      }

      if (dueBadge || assigneeBadge) {
        const metaDiv = document.createElement("div");
        metaDiv.className = "kanban-card-meta";
        if (dueBadge) metaDiv.appendChild(dueBadge);
        if (assigneeBadge) metaDiv.appendChild(assigneeBadge);
        contentDiv.appendChild(metaDiv);
      }

      // Card Action Buttons (Hover / Focus within)
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "kanban-card-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "task-action-btn";
      editBtn.title = "Edit task";
      editBtn.setAttribute("aria-label", `Edit ${task.title}`);
      editBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
      `;
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditTaskModal(task.id);
      });
      editBtn.addEventListener("mousedown", (e) => e.stopPropagation());

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "task-action-btn danger";
      deleteBtn.title = "Delete task";
      deleteBtn.setAttribute("aria-label", `Delete ${task.title}`);
      deleteBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openDeleteTaskModal(task.id);
      });
      deleteBtn.addEventListener("mousedown", (e) => e.stopPropagation());

      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(deleteBtn);

      card.appendChild(contentDiv);
      card.appendChild(actionsDiv);

      // Clicking anywhere on card opens edit task modal
      card.addEventListener("click", () => {
        if (state.sync.isDragging) return;
        openEditTaskModal(task.id);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openEditTaskModal(task.id);
        }
      });

      // HTML5 Drag Events
      card.addEventListener("dragstart", (e) => handleCardDragStart(e, task.id));
      card.addEventListener("dragend", handleCardDragEnd);

      listEl.appendChild(card);
    });
  });
}

// =====================================================================
// 12. CANVAS VIEW & DRAG ENGINE (Free Spatial Layout)
// =====================================================================

/**
 * Fetches saved task canvas positions from the backend for the specified project.
 * Accessible to both Owner and Members. Does not touch project revision.
 */
async function loadCanvasPositions(projectId) {
  if (!projectId || state.screen !== "project" || state.selectedProjectId !== projectId) return;

  const fetchSeq = ++currentCanvasFetchSeq;
  state.canvas.loading = true;

  try {
    const res = await api.request(`/api/projects/${projectId}/canvas-positions`, {
      method: "GET",
      silent: true
    });

    // Stale guard against rapid project switching
    if (
      fetchSeq !== currentCanvasFetchSeq ||
      state.screen !== "project" ||
      state.selectedProjectId !== projectId
    ) {
      return;
    }

    if (res && res.ok && res.data && res.data.ok) {
      const list = res.data.data.positions || [];
      const posMap = {};
      list.forEach(p => {
        posMap[p.task_id] = { x: p.x, y: p.y };
      });
      state.canvas.positions = posMap;
      state.canvas.loadedProjectId = projectId;

      // Automatically place and persist any existing tasks that lack positions
      await initializeMissingCanvasPositions(projectId);
    }
  } finally {
    state.canvas.loading = false;
    if (state.view === "canvas") {
      renderTasks();
    }
  }
}

/**
 * Calculates a predictable default position for a newly created task on the canvas.
 * Places below the current lowest occupied row (Requirement 30).
 */
function getNextDefaultCanvasPosition() {
  let maxY = 0;
  let hasAny = false;
  Object.values(state.canvas.positions).forEach(p => {
    hasAny = true;
    if (p.y > maxY) maxY = p.y;
  });

  if (!hasAny) {
    return { x: 40, y: 40 };
  }

  return { x: 40, y: maxY + 160 };
}

/**
 * Detects any tasks in state.tasks that do not have saved canvas positions,
 * arranges them in a deterministic grid (below any existing nodes), and
 * persists the batch to SQLite with ONE PUT request (Requirements 28-32).
 */
async function initializeMissingCanvasPositions(projectId) {
  if (!projectId || state.selectedProjectId !== projectId) return;

  const missingTasks = state.tasks.filter(t => !state.canvas.positions[t.id]);
  if (missingTasks.length === 0) return;

  // Stable sort by id ASC
  missingTasks.sort((a, b) => a.id - b.id);

  let hasExisting = Object.keys(state.canvas.positions).length > 0;
  let maxY = 0;
  if (hasExisting) {
    Object.values(state.canvas.positions).forEach(p => {
      if (p.y > maxY) maxY = p.y;
    });
  }

  const startY = hasExisting ? maxY + 160 : 40;
  const startX = 40;
  const colWidth = 260;
  const hGap = 32;
  const vGap = 32;
  const rowHeight = 130;
  const colsPerRow = 4;

  const newPositions = [];
  missingTasks.forEach((task, idx) => {
    const col = idx % colsPerRow;
    const row = Math.floor(idx / colsPerRow);
    const x = startX + col * (colWidth + hGap);
    const y = startY + row * (rowHeight + vGap);

    state.canvas.positions[task.id] = { x, y };
    newPositions.push({ task_id: task.id, x, y });
  });

  // Batch save the newly generated initial positions in ONE request
  try {
    const res = await api.request(`/api/projects/${projectId}/canvas-positions`, {
      method: "PUT",
      body: JSON.stringify({ positions: newPositions }),
      silent: true
    });
    if (res && res.ok && res.data && res.data.ok) {
      if (res.data.project_revision != null) {
        state.sync.lastRevision = res.data.project_revision;
      }
    }
  } catch (err) {
    console.warn("Could not save initial canvas positions batch:", err);
  }
}

/**
 * Dynamically expands the canvas surface when nodes approach edges (Section 41, 42).
 * Uses a high-water mark in world coordinates to prevent aggressive shrinking.
 */
function updateCanvasSurfaceDimensions(maxX, maxY) {
  const surfaceEl = document.getElementById("canvas-surface");
  if (!surfaceEl) return;

  const neededWidth = Math.max(2000, maxX + 260 + 80);
  const neededHeight = Math.max(1200, maxY + 150 + 80);

  if (neededWidth > state.canvas.surfaceWidth) {
    state.canvas.surfaceWidth = neededWidth;
  }
  if (neededHeight > state.canvas.surfaceHeight) {
    state.canvas.surfaceHeight = neededHeight;
  }

  surfaceEl.style.minWidth = `${state.canvas.surfaceWidth}px`;
  surfaceEl.style.minHeight = `${state.canvas.surfaceHeight}px`;
}

/**
 * Applies the camera transformation (panX, panY, zoom) to the canvas transform layer (Section 12, 13).
 * Also keeps the background dot grid in sync and updates the zoom percentage label.
 */
function applyCanvasTransform() {
  const layer = document.getElementById("canvas-transform-layer");
  const viewport = document.getElementById("canvas-viewport");
  const { panX, panY, zoom } = state.canvas.camera;

  if (layer) {
    layer.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  if (viewport) {
    viewport.style.backgroundPosition = `${panX}px ${panY}px`;
    viewport.style.backgroundSize = `${24 * zoom}px ${24 * zoom}px`;
  }

  const label = document.getElementById("canvas-zoom-label");
  if (label) {
    const pct = Math.round(zoom * 100);
    label.textContent = `${pct}%`;
    label.setAttribute("aria-label", `Canvas zoom ${pct} percent`);
  }

  updateMinimapViewport();
}

/**
 * Converts screen client coordinates (clientX, clientY) to Canvas world coordinates (Section 15, 16).
 * Accounts for viewport bounding rect, pan offset, and zoom factor.
 */
function screenToCanvasWorld(clientX, clientY) {
  const viewport = document.getElementById("canvas-viewport");
  const rect = viewport ? viewport.getBoundingClientRect() : { left: 0, top: 0 };
  const screenX = clientX - rect.left;
  const screenY = clientY - rect.top;
  const { panX, panY, zoom } = state.canvas.camera;
  return {
    x: Math.max(0, Math.round((screenX - panX) / zoom)),
    y: Math.max(0, Math.round((screenY - panY) / zoom))
  };
}

/**
 * Converts Canvas world coordinates (worldX, worldY) to screen client coordinates (Section 15).
 */
function canvasWorldToScreen(worldX, worldY) {
  const viewport = document.getElementById("canvas-viewport");
  const rect = viewport ? viewport.getBoundingClientRect() : { left: 0, top: 0 };
  const { panX, panY, zoom } = state.canvas.camera;
  return {
    x: rect.left + panX + worldX * zoom,
    y: rect.top + panY + worldY * zoom
  };
}

/**
 * Centralized camera pan clamping to prevent accidental infinite pan drift (Section 38, 39, 40).
 */
function clampCanvasCamera() {
  const viewport = document.getElementById("canvas-viewport");
  const vWidth = viewport ? viewport.clientWidth : 1200;
  const vHeight = viewport ? viewport.clientHeight : 800;
  const zoom = state.canvas.camera.zoom;
  const sWidth = Math.max(2000, state.canvas.surfaceWidth);
  const sHeight = Math.max(1200, state.canvas.surfaceHeight);
  const margin = 800;

  const maxPanX = margin;
  const minPanX = Math.min(-100, vWidth - (sWidth * zoom + margin));
  const maxPanY = margin;
  const minPanY = Math.min(-100, vHeight - (sHeight * zoom + margin));

  state.canvas.camera.panX = Math.min(maxPanX, Math.max(minPanX, state.canvas.camera.panX));
  state.canvas.camera.panY = Math.min(maxPanY, Math.max(minPanY, state.canvas.camera.panY));
}

/**
 * Zooms the canvas anchored around an exact screen coordinate (Section 20, 21).
 * Preserves the world coordinate directly under the pointer.
 */
function zoomCanvasAtPoint(targetZoom, clientX, clientY) {
  const viewport = document.getElementById("canvas-viewport");
  if (!viewport) return;

  const oldZoom = state.canvas.camera.zoom;
  const newZoom = Math.max(CANVAS_MIN_ZOOM, Math.min(CANVAS_MAX_ZOOM, Math.round(targetZoom * 100) / 100));
  if (Math.abs(newZoom - oldZoom) < 0.001) return;

  const rect = viewport.getBoundingClientRect();
  const cursorX = clientX - rect.left;
  const cursorY = clientY - rect.top;

  // World point under cursor before zoom
  const worldX = (cursorX - state.canvas.camera.panX) / oldZoom;
  const worldY = (cursorY - state.canvas.camera.panY) / oldZoom;

  // New pan to keep the world point at the cursor position
  state.canvas.camera.panX = cursorX - worldX * newZoom;
  state.canvas.camera.panY = cursorY - worldY * newZoom;
  state.canvas.camera.zoom = newZoom;

  clampCanvasCamera();
  applyCanvasTransform();
}

/**
 * Zooms the canvas centered in the viewport (for +/- buttons) (Section 49).
 */
function zoomCanvasCenter(deltaZoom) {
  const viewport = document.getElementById("canvas-viewport");
  if (!viewport) return;
  const rect = viewport.getBoundingClientRect();
  zoomCanvasAtPoint(state.canvas.camera.zoom + deltaZoom, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

/**
 * Calculates bounding box of currently visible tasks and adjusts camera to fit them comfortably (Section 50-55).
 * Does NOT modify persisted task positions.
 */
function fitCanvasTasks() {
  const viewport = document.getElementById("canvas-viewport");
  if (!viewport) return;

  const visibleTasks = getVisibleTasks();
  if (!visibleTasks || visibleTasks.length === 0) {
    state.canvas.camera.zoom = 1.0;
    state.canvas.camera.panX = 40;
    state.canvas.camera.panY = 40;
    clampCanvasCamera();
    applyCanvasTransform();
    return;
  }

  const nodeWidth = 260;
  const nodeHeight = 140;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  visibleTasks.forEach(task => {
    const pos = state.canvas.positions[task.id];
    if (pos) {
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.x + nodeWidth > maxX) maxX = pos.x + nodeWidth;
      if (pos.y + nodeHeight > maxY) maxY = pos.y + nodeHeight;
    }
  });

  if (minX === Infinity) {
    state.canvas.camera.zoom = 1.0;
    state.canvas.camera.panX = 40;
    state.canvas.camera.panY = 40;
    clampCanvasCamera();
    applyCanvasTransform();
    return;
  }

  const padding = 60;
  const bboxWidth = (maxX - minX) + padding * 2;
  const bboxHeight = (maxY - minY) + padding * 2;
  const vWidth = viewport.clientWidth;
  const vHeight = viewport.clientHeight;

  let targetZoom;
  if (visibleTasks.length === 1) {
    targetZoom = 1.0;
  } else {
    const scaleX = vWidth / Math.max(1, bboxWidth);
    const scaleY = vHeight / Math.max(1, bboxHeight);
    const fitScale = Math.min(scaleX, scaleY);
    targetZoom = Math.max(CANVAS_MIN_ZOOM, Math.min(1.0, fitScale));
    targetZoom = Math.round(targetZoom * 100) / 100;
  }

  const bboxCenterX = minX + (maxX - minX) / 2;
  const bboxCenterY = minY + (maxY - minY) / 2;

  state.canvas.camera.zoom = targetZoom;
  state.canvas.camera.panX = Math.round(vWidth / 2 - bboxCenterX * targetZoom);
  state.canvas.camera.panY = Math.round(vHeight / 2 - bboxCenterY * targetZoom);

  clampCanvasCamera();
  applyCanvasTransform();
}

/**
 * Checks if an event target corresponds to the blank canvas background (Section 102).
 */
function isBlankCanvasTarget(target) {
  if (!target) return false;
  if (target.closest(".canvas-node")) return false;
  if (target.closest(".canvas-node-handle")) return false;
  if (target.closest(".canvas-zoom-controls")) return false;
  if (target.closest(".canvas-minimap-container")) return false;
  if (target.closest(".canvas-empty-card")) return false;
  if (target.closest(".canvas-edge-delete-btn")) return false;
  if (target.closest(".canvas-edge")) return false;
  if (target.closest(".modal-backdrop, .modal-card, .btn, button, input, select, textarea, label")) return false;

  const viewport = document.getElementById("canvas-viewport");
  if (viewport && viewport.contains(target)) return true;
  return false;
}

/**
 * Renders visible tasks as draggable absolute-positioned nodes on the canvas surface.
 * Safely renders all user content with textContent (XSS protection).
 */
function renderCanvasView(visibleTasks) {
  const surfaceEl = document.getElementById("canvas-surface");
  const emptyOverlay = document.getElementById("canvas-empty-overlay");
  const emptyTitle = document.getElementById("canvas-empty-title");
  const emptySubtitle = document.getElementById("canvas-empty-subtitle");
  const emptyAddBtn = document.getElementById("canvas-empty-add-btn");
  const emptyClearBtn = document.getElementById("canvas-empty-clear-btn");
  if (!surfaceEl) return;

  surfaceEl.innerHTML = "";

  const hasAnyTasksInProject = state.tasks.length > 0;

  if (visibleTasks.length === 0) {
    if (emptyOverlay) {
      emptyOverlay.style.display = "block";
      if (!hasAnyTasksInProject) {
        if (emptyTitle) emptyTitle.textContent = "No tasks in this project yet.";
        if (emptySubtitle) emptySubtitle.textContent = "Get started by creating your first task, or double-click the canvas.";
        if (emptyAddBtn) emptyAddBtn.style.display = "inline-flex";
        if (emptyClearBtn) emptyClearBtn.style.display = "none";
      } else {
        if (emptyTitle) emptyTitle.textContent = "No matching tasks found.";
        if (emptySubtitle) {
          if (state.assigneeFilter === "me") {
            emptySubtitle.textContent = "No tasks are currently assigned to you.";
          } else {
            emptySubtitle.textContent = "No tasks match your current criteria. Double-click the canvas to add a task.";
          }
        }
        if (emptyAddBtn) emptyAddBtn.style.display = "none";
        if (emptyClearBtn) emptyClearBtn.style.display = "inline-flex";
      }
    }
    applyCanvasTransform();
    renderCanvasDependencies();
    renderCanvasMinimap(visibleTasks);
    return;
  }

  if (emptyOverlay) {
    emptyOverlay.style.display = "none";
  }

  let maxNodeX = 0;
  let maxNodeY = 0;

  visibleTasks.forEach(task => {
    let pos = state.canvas.positions[task.id];
    if (!pos) {
      pos = getNextDefaultCanvasPosition();
      state.canvas.positions[task.id] = pos;
    }

    const node = document.createElement("div");
    node.className = "canvas-node";
    node.id = `canvas-node-${task.id}`;
    node.dataset.taskId = String(task.id);
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", `Task: ${task.title}`);
    node.style.left = `${pos.x}px`;
    node.style.top = `${pos.y}px`;

    // 1. Title
    const titleEl = document.createElement("div");
    titleEl.className = "canvas-node-title";
    titleEl.textContent = task.title;
    node.appendChild(titleEl);

    // 2. Description preview (1-2 lines)
    if (task.description && task.description.trim()) {
      const descEl = document.createElement("div");
      descEl.className = "canvas-node-desc";
      descEl.textContent = task.description.trim();
      node.appendChild(descEl);
    }

    // 3. Footer: Status, Assignee, Due date badge
    const footerEl = document.createElement("div");
    footerEl.className = "canvas-node-footer";

    const metaEl = document.createElement("div");
    metaEl.className = "canvas-node-meta";

    const statusDot = document.createElement("span");
    statusDot.className = `status-dot status-${task.status.toLowerCase()}`;
    statusDot.setAttribute("aria-hidden", "true");
    metaEl.appendChild(statusDot);

    const statusText = document.createElement("span");
    statusText.className = "canvas-node-status";
    statusText.textContent = task.status;
    metaEl.appendChild(statusText);

    if (task.assignee_username) {
      const dotSep = document.createElement("span");
      dotSep.textContent = "·";
      metaEl.appendChild(dotSep);

      const assigneeEl = document.createElement("span");
      assigneeEl.className = "canvas-node-assignee";
      assigneeEl.textContent = task.assignee_username;
      metaEl.appendChild(assigneeEl);
    }

    footerEl.appendChild(metaEl);

    const dueBadge = renderDueBadgeElement(task, true);
    if (dueBadge) {
      dueBadge.classList.add("canvas-node-due");
      footerEl.appendChild(dueBadge);
    }

    node.appendChild(footerEl);

    // 4. Connect handle (right side for A -> B drag) (Section 41-43)
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "canvas-node-handle";
    handle.setAttribute("aria-label", `Create dependency from ${task.title}`);
    handle.title = "Drag to connect dependency";
    handle.dataset.taskId = String(task.id);
    setupCanvasNodeConnectHandle(handle, task.id);
    node.appendChild(handle);

    // Keyboard accessibility: Enter or Space opens task details dialog
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openEditTaskModal(task.id);
      }
    });

    // Pointer Events drag & click handling
    setupCanvasNodePointer(node, task.id);

    surfaceEl.appendChild(node);

    maxNodeX = Math.max(maxNodeX, pos.x);
    maxNodeY = Math.max(maxNodeY, pos.y);
  });

  updateCanvasSurfaceDimensions(maxNodeX, maxNodeY);
  applyCanvasTransform();
  renderCanvasDependencies();
  renderCanvasMinimap(visibleTasks);
}

/**
 * Attaches Pointer Events to a canvas node.
 * Translates screen deltas to world coordinates divided by zoom factor (Section 32, 33).
 * Uses a screen pixel movement threshold to distinguish Click vs Drag.
 * Zero network requests during pointermove; exactly ONE batch save on drop.
 * Rolls back to original coordinates on network/server error.
 */
function setupCanvasNodePointer(nodeEl, taskId) {
  nodeEl.addEventListener("pointerdown", (e) => {
    // If middle mouse or Space is held, let event bubble to canvas viewport for panning!
    if (e.button === 1 || state.canvas.spacePressed) {
      return;
    }

    // Only primary left button for node dragging
    if (e.button !== 0) return;

    // Prevent accidental text selection during drag
    e.preventDefault();

    const currentPos = state.canvas.positions[taskId] || { x: 0, y: 0 };
    const startPointerX = e.clientX;
    const startPointerY = e.clientY;
    const originX = currentPos.x;
    const originY = currentPos.y;
    let isDragging = false;
    let hasMoved = false;

    function onPointerMove(moveEvent) {
      const screenDx = moveEvent.clientX - startPointerX;
      const screenDy = moveEvent.clientY - startPointerY;

      if (!isDragging) {
        if (Math.abs(screenDx) > 5 || Math.abs(screenDy) > 5) {
          isDragging = true;
          hasMoved = true;
          state.sync.isDragging = true; // Defer remote revision sync during local drag
          try {
            nodeEl.setPointerCapture(moveEvent.pointerId);
          } catch (_) {}
          nodeEl.classList.add("dragging");
        }
      }

      if (isDragging) {
        // Correct coordinate delta under zoom: deltaWorld = deltaScreen / zoom
        const zoom = state.canvas.camera.zoom || 1.0;
        const deltaWorldX = screenDx / zoom;
        const deltaWorldY = screenDy / zoom;

        // Clamping to Canvas origin (x >= 0, y >= 0)
        const newX = Math.max(0, Math.round(originX + deltaWorldX));
        const newY = Math.max(0, Math.round(originY + deltaWorldY));
        nodeEl.style.left = `${newX}px`;
        nodeEl.style.top = `${newY}px`;
        updateCanvasSurfaceDimensions(newX, newY);
        updateConnectedCanvasEdges(taskId, newX, newY);
        updateMinimapTaskPosition(taskId, newX, newY);
      }
    }

    async function onPointerUp(upEvent) {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      try {
        nodeEl.releasePointerCapture(upEvent.pointerId);
      } catch (_) {}

      nodeEl.classList.remove("dragging");

      if (!hasMoved) {
        // Less than threshold: user clicked -> open task modal
        openEditTaskModal(taskId);
        return;
      }

      // Drag ended: compute final clamped world coordinates
      const zoom = state.canvas.camera.zoom || 1.0;
      const finalX = Math.max(0, Math.round(originX + (upEvent.clientX - startPointerX) / zoom));
      const finalY = Math.max(0, Math.round(originY + (upEvent.clientY - startPointerY) / zoom));

      state.canvas.positions[taskId] = { x: finalX, y: finalY };
      updateConnectedCanvasEdges(taskId, finalX, finalY);
      renderCanvasMinimap(getVisibleTasks());

      const projectId = state.selectedProjectId;
      try {
        const res = await api.request(`/api/projects/${projectId}/canvas-positions`, {
          method: "PUT",
          body: JSON.stringify({
            positions: [{ task_id: taskId, x: finalX, y: finalY }]
          }),
          silent: true
        });

        if (res && res.ok && res.data && res.data.ok) {
          if (res.data.project_revision != null) {
            state.sync.lastRevision = res.data.project_revision;
          }
        } else {
          // Rollback on server error
          nodeEl.style.left = `${originX}px`;
          nodeEl.style.top = `${originY}px`;
          state.canvas.positions[taskId] = { x: originX, y: originY };
          updateConnectedCanvasEdges(taskId, originX, originY);
          renderCanvasMinimap(getVisibleTasks());
          showToast("Could not save task position.", "error");
        }
      } catch (err) {
        // Rollback on network failure
        nodeEl.style.left = `${originX}px`;
        nodeEl.style.top = `${originY}px`;
        state.canvas.positions[taskId] = { x: originX, y: originY };
        updateConnectedCanvasEdges(taskId, originX, originY);
        renderCanvasMinimap(getVisibleTasks());
        showToast("Could not save task position.", "error");
      } finally {
        state.sync.isDragging = false;
        // Run any revision sync deferred during the drag
        if (state.sync.deferred && state.sync.pendingRevision != null) {
          const pendingRev = state.sync.pendingRevision;
          state.sync.deferred = false;
          state.sync.pendingRevision = null;
          await syncCurrentProject(pendingRev);
        }
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  });
}

// =====================================================================
// 12B. CANVAS DEPENDENCIES ENGINE (Directed Prerequisite Edges)
// =====================================================================

/**
 * Fetches saved task dependencies from the backend for the specified project.
 * Accessible to both Owner and Members. Does not touch project revision.
 */
async function loadCanvasDependencies(projectId) {
  if (!projectId || state.screen !== "project" || state.selectedProjectId !== projectId) return;

  const fetchSeq = currentCanvasFetchSeq;

  try {
    const res = await api.request(`/api/projects/${projectId}/dependencies`, {
      method: "GET",
      silent: true
    });

    if (
      fetchSeq !== currentCanvasFetchSeq ||
      state.screen !== "project" ||
      state.selectedProjectId !== projectId
    ) {
      return;
    }

    if (res && res.ok && res.data && res.data.ok) {
      state.canvas.dependencies = res.data.data.dependencies || [];
      if (state.canvas.selectedDependency) {
        const stillExists = state.canvas.dependencies.some(
          d => d.from_task_id === state.canvas.selectedDependency.from_task_id &&
               d.to_task_id === state.canvas.selectedDependency.to_task_id
        );
        if (!stillExists) {
          state.canvas.selectedDependency = null;
        }
      }
    }
  } catch (err) {
    console.warn("Could not load canvas dependencies:", err);
  } finally {
    if (state.view === "canvas") {
      renderCanvasDependencies();
    }
  }
}

/**
 * Creates a directed dependency from_task_id -> to_task_id on the server.
 * Transactional: increments project revision once.
 */
async function createTaskDependency(fromTaskId, toTaskId) {
  const projectId = state.selectedProjectId;
  if (!projectId) return;

  try {
    const res = await api.request(`/api/projects/${projectId}/dependencies`, {
      method: "POST",
      body: JSON.stringify({ from_task_id: fromTaskId, to_task_id: toTaskId }),
      silent: true
    });

    if (res && res.ok && res.data && res.data.ok) {
      const newDep = res.data.data;
      const exists = state.canvas.dependencies.some(
        d => d.from_task_id === newDep.from_task_id && d.to_task_id === newDep.to_task_id
      );
      if (!exists) {
        state.canvas.dependencies.push({
          from_task_id: newDep.from_task_id,
          to_task_id: newDep.to_task_id,
          created_at: newDep.created_at
        });
      }

      if (res.data.project_revision != null) {
        state.sync.lastRevision = res.data.project_revision;
      }

      renderCanvasDependencies();
    } else {
      const err = res?.data?.error || "Could not create dependency.";
      showToast(err, "error");
    }
  } catch (err) {
    showToast("Network error creating dependency.", "error");
  }
}

/**
 * Deletes an existing directed dependency from_task_id -> to_task_id on the server.
 * Transactional: increments project revision once.
 */
async function deleteTaskDependency(fromTaskId, toTaskId) {
  const projectId = state.selectedProjectId;
  if (!projectId) return;

  try {
    const res = await api.request(`/api/projects/${projectId}/dependencies`, {
      method: "DELETE",
      body: JSON.stringify({ from_task_id: fromTaskId, to_task_id: toTaskId }),
      silent: true
    });

    if (res && res.ok && res.data && res.data.ok) {
      state.canvas.dependencies = state.canvas.dependencies.filter(
        d => !(d.from_task_id === fromTaskId && d.to_task_id === toTaskId)
      );

      if (
        state.canvas.selectedDependency &&
        state.canvas.selectedDependency.from_task_id === fromTaskId &&
        state.canvas.selectedDependency.to_task_id === toTaskId
      ) {
        state.canvas.selectedDependency = null;
      }

      if (res.data.project_revision != null) {
        state.sync.lastRevision = res.data.project_revision;
      }

      renderCanvasDependencies();
      showToast("Dependency removed.", "info");
    } else {
      const err = res?.data?.error || "Could not remove dependency.";
      showToast(err, "error");
    }
  } catch (err) {
    showToast("Network error removing dependency.", "error");
  }
}

/**
 * Centralized helper for retrieving world-space bounds of a task node (Section 34).
 * Returns { x, y, width, height } in unscaled canvas world coordinates.
 */
function getCanvasNodeBounds(taskId) {
  const el = document.getElementById(`canvas-node-${taskId}`);
  const pos = state.canvas.positions[taskId] || { x: 0, y: 0 };
  if (el) {
    const x = parseFloat(el.style.left);
    const y = parseFloat(el.style.top);
    return {
      x: isNaN(x) ? pos.x : x,
      y: isNaN(y) ? pos.y : y,
      width: el.offsetWidth || 260,
      height: el.offsetHeight || 130
    };
  }
  return {
    x: pos.x,
    y: pos.y,
    width: 260,
    height: 130
  };
}

/**
 * Generates smooth cubic Bézier SVG path data between two world points (Section 31, 98, 99).
 * startPoint: { x, y } right-center of predecessor task
 * endPoint: { x, y } left-center of dependent task
 */
function buildDependencyPath(startPoint, endPoint) {
  const dx = endPoint.x - startPoint.x;
  let cp1x, cp1y, cp2x, cp2y;

  if (dx >= 0) {
    const offset = Math.max(40, dx * 0.5);
    cp1x = startPoint.x + offset;
    cp1y = startPoint.y;
    cp2x = endPoint.x - offset;
    cp2y = endPoint.y;
  } else {
    // Reverse spatial order: bend outward smoothly
    const offset = Math.max(60, Math.abs(dx) * 0.35);
    cp1x = startPoint.x + offset;
    cp1y = startPoint.y;
    cp2x = endPoint.x - offset;
    cp2y = endPoint.y;
  }

  return `M ${startPoint.x.toFixed(1)} ${startPoint.y.toFixed(1)} C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${endPoint.x.toFixed(1)} ${endPoint.y.toFixed(1)}`;
}

/**
 * Renders all valid dependency edges in the SVG layer (Section 25-30, 66).
 * Only renders edges if BOTH endpoint tasks are currently visible.
 */
function renderCanvasDependencies() {
  if (state.view !== "canvas") return;
  const edgeGroup = document.getElementById("canvas-edge-group");
  const deleteBtn = document.getElementById("canvas-edge-delete-btn");
  if (!edgeGroup) return;

  edgeGroup.innerHTML = "";

  const visibleTasks = getVisibleTasks();
  const visibleTaskIds = new Set(visibleTasks.map(t => t.id));

  let selectedEdgeFound = false;

  state.canvas.dependencies.forEach(dep => {
    // Both endpoints must be visible (Section 66)
    if (!visibleTaskIds.has(dep.from_task_id) || !visibleTaskIds.has(dep.to_task_id)) {
      return;
    }

    const fromBounds = getCanvasNodeBounds(dep.from_task_id);
    const toBounds = getCanvasNodeBounds(dep.to_task_id);

    const startPoint = { x: fromBounds.x + fromBounds.width, y: fromBounds.y + fromBounds.height / 2 };
    const endPoint = { x: toBounds.x, y: toBounds.y + toBounds.height / 2 };
    const d = buildDependencyPath(startPoint, endPoint);

    const isSelected =
      state.canvas.selectedDependency &&
      state.canvas.selectedDependency.from_task_id === dep.from_task_id &&
      state.canvas.selectedDependency.to_task_id === dep.to_task_id;

    if (isSelected) {
      selectedEdgeFound = true;
    }

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", `canvas-edge${isSelected ? " selected" : ""}`);
    g.setAttribute("data-from", String(dep.from_task_id));
    g.setAttribute("data-to", String(dep.to_task_id));

    // Transparent wider hit path for easy clicking (Section 57)
    const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hitPath.setAttribute("class", "canvas-edge-hit");
    hitPath.setAttribute("d", d);

    // Visible stylized path with arrowhead
    const linePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    linePath.setAttribute("class", "canvas-edge-line");
    linePath.setAttribute("d", d);
    linePath.setAttribute("marker-end", isSelected ? "url(#canvas-arrowhead-selected)" : "url(#canvas-arrowhead)");

    g.appendChild(hitPath);
    g.appendChild(linePath);

    // Click handler for edge selection
    g.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });

    g.addEventListener("click", (e) => {
      e.stopPropagation();
      selectCanvasEdge(dep.from_task_id, dep.to_task_id, (startPoint.x + endPoint.x) / 2, (startPoint.y + endPoint.y) / 2);
    });

    edgeGroup.appendChild(g);
  });

  if (selectedEdgeFound && state.canvas.selectedDependency) {
    const selFrom = state.canvas.selectedDependency.from_task_id;
    const selTo = state.canvas.selectedDependency.to_task_id;
    const fromBounds = getCanvasNodeBounds(selFrom);
    const toBounds = getCanvasNodeBounds(selTo);
    const midX = (fromBounds.x + fromBounds.width + toBounds.x) / 2;
    const midY = (fromBounds.y + fromBounds.height / 2 + toBounds.y + toBounds.height / 2) / 2;

    if (deleteBtn) {
      deleteBtn.style.left = `${midX}px`;
      deleteBtn.style.top = `${midY}px`;
      deleteBtn.style.display = "block";
    }
  } else {
    if (deleteBtn) {
      deleteBtn.style.display = "none";
    }
    state.canvas.selectedDependency = null;
  }
}

/**
 * Real-time live update for dependency edges connected to a dragged task node (Section 38, 39, 103).
 * Operates purely on SVG DOM paths with ZERO network requests.
 */
function updateConnectedCanvasEdges(taskId, currentX, currentY) {
  if (state.view !== "canvas") return;
  const edgeGroup = document.getElementById("canvas-edge-group");
  if (!edgeGroup) return;

  const visibleTaskIds = new Set(getVisibleTasks().map(t => t.id));
  if (!visibleTaskIds.has(taskId)) return;

  state.canvas.dependencies.forEach(dep => {
    if (dep.from_task_id !== taskId && dep.to_task_id !== taskId) return;
    if (!visibleTaskIds.has(dep.from_task_id) || !visibleTaskIds.has(dep.to_task_id)) return;

    const fromBounds = dep.from_task_id === taskId
      ? { ...getCanvasNodeBounds(taskId), x: currentX, y: currentY }
      : getCanvasNodeBounds(dep.from_task_id);

    const toBounds = dep.to_task_id === taskId
      ? { ...getCanvasNodeBounds(taskId), x: currentX, y: currentY }
      : getCanvasNodeBounds(dep.to_task_id);

    const startPoint = { x: fromBounds.x + fromBounds.width, y: fromBounds.y + fromBounds.height / 2 };
    const endPoint = { x: toBounds.x, y: toBounds.y + toBounds.height / 2 };
    const d = buildDependencyPath(startPoint, endPoint);

    const edgeEl = edgeGroup.querySelector(`.canvas-edge[data-from="${dep.from_task_id}"][data-to="${dep.to_task_id}"]`);
    if (edgeEl) {
      const hitPath = edgeEl.querySelector(".canvas-edge-hit");
      const linePath = edgeEl.querySelector(".canvas-edge-line");
      if (hitPath) hitPath.setAttribute("d", d);
      if (linePath) linePath.setAttribute("d", d);
    }

    if (
      state.canvas.selectedDependency &&
      state.canvas.selectedDependency.from_task_id === dep.from_task_id &&
      state.canvas.selectedDependency.to_task_id === dep.to_task_id
    ) {
      const deleteBtn = document.getElementById("canvas-edge-delete-btn");
      if (deleteBtn && deleteBtn.style.display !== "none") {
        deleteBtn.style.left = `${(startPoint.x + endPoint.x) / 2}px`;
        deleteBtn.style.top = `${(startPoint.y + endPoint.y) / 2}px`;
      }
    }
  });
}

/**
 * Selects an edge and positions the contextual delete button.
 */
function selectCanvasEdge(fromTaskId, toTaskId, midX, midY) {
  state.canvas.selectedDependency = { from_task_id: fromTaskId, to_task_id: toTaskId };
  renderCanvasDependencies();
}

/**
 * Opens confirmation modal for removing a dependency (Section 60).
 */
function openDeleteDependencyModal(fromTaskId, toTaskId) {
  const fromTask = state.tasks.find(t => t.id === fromTaskId);
  const toTask = state.tasks.find(t => t.id === toTaskId);
  const fromTitle = fromTask ? fromTask.title : `Task #${fromTaskId}`;
  const toTitle = toTask ? toTask.title : `Task #${toTaskId}`;

  const descEl = document.getElementById("delete-dependency-desc");
  if (descEl) {
    descEl.textContent = `"${toTitle}" will no longer depend on "${fromTitle}".`;
  }

  state.canvas.pendingDeleteDependency = { from_task_id: fromTaskId, to_task_id: toTaskId };
  openModal("modal-delete-dependency");
}

/**
 * Attaches pointerdown to connect handle to initiate dependency drag (Section 41-43).
 */
function setupCanvasNodeConnectHandle(handleEl, sourceTaskId) {
  handleEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    startDependencyConnection(e, sourceTaskId);
  });
}

/**
 * Initiates drag-to-connect dependency gesture with live preview (Section 44, 45, 135).
 */
function startDependencyConnection(startEvent, sourceTaskId) {
  const viewport = document.getElementById("canvas-viewport");
  const previewEl = document.getElementById("canvas-edge-preview");
  const sourceNode = document.getElementById(`canvas-node-${sourceTaskId}`);
  if (!viewport || !previewEl) return;

  state.canvas.isConnecting = true;
  state.canvas.connectSourceTaskId = sourceTaskId;
  state.sync.isDragging = true; // Defer remote revision sync during active connection

  if (sourceNode) {
    sourceNode.classList.add("connecting-source");
  }

  const fromBounds = getCanvasNodeBounds(sourceTaskId);
  const startPoint = { x: fromBounds.x + fromBounds.width, y: fromBounds.y + fromBounds.height / 2 };
  const worldPoint = screenToCanvasWorld(startEvent.clientX, startEvent.clientY);
  const d = buildDependencyPath(startPoint, worldPoint);

  previewEl.setAttribute("d", d);
  previewEl.style.display = "block";

  try {
    startEvent.target.setPointerCapture(startEvent.pointerId);
  } catch (_) {}

  function onConnectMove(moveEvent) {
    if (!state.canvas.isConnecting) return;

    const currentWorld = screenToCanvasWorld(moveEvent.clientX, moveEvent.clientY);
    const updatedD = buildDependencyPath(startPoint, currentWorld);
    previewEl.setAttribute("d", updatedD);

    // Hit-testing potential drop targets
    const elemUnder = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
    const targetNode = elemUnder ? elemUnder.closest(".canvas-node") : null;

    document.querySelectorAll(".canvas-node.drop-target").forEach(n => {
      n.classList.remove("drop-target");
    });

    if (targetNode) {
      const targetId = parseInt(targetNode.dataset.taskId, 10);
      if (targetId && targetId !== state.canvas.connectSourceTaskId) {
        targetNode.classList.add("drop-target");
      }
    }
  }

  async function onConnectEnd(endEvent) {
    window.removeEventListener("pointermove", onConnectMove);
    window.removeEventListener("pointerup", onConnectEnd);
    window.removeEventListener("pointercancel", onConnectEnd);

    try {
      startEvent.target.releasePointerCapture(endEvent.pointerId);
    } catch (_) {}

    cancelDependencyConnectionVisuals();

    // Prevent double-click quick create immediately following connection release
    state.canvas.justConnected = true;
    setTimeout(() => {
      state.canvas.justConnected = false;
    }, 300);

    const elemUnder = document.elementFromPoint(endEvent.clientX, endEvent.clientY);
    const targetNode = elemUnder ? elemUnder.closest(".canvas-node") : null;
    const toTaskId = targetNode ? parseInt(targetNode.dataset.taskId, 10) : null;
    const fromTaskId = state.canvas.connectSourceTaskId;

    state.canvas.isConnecting = false;
    state.canvas.connectSourceTaskId = null;

    if (toTaskId && fromTaskId && toTaskId !== fromTaskId) {
      // Check duplicate edge before sending request (Section 51)
      const alreadyExists = state.canvas.dependencies.some(
        d => d.from_task_id === fromTaskId && d.to_task_id === toTaskId
      );

      if (alreadyExists) {
        showToast("Dependency already exists.", "info");
      } else {
        await createTaskDependency(fromTaskId, toTaskId);
      }
    }

    state.sync.isDragging = false;
    if (state.sync.deferred && state.sync.pendingRevision != null) {
      const pendingRev = state.sync.pendingRevision;
      state.sync.deferred = false;
      state.sync.pendingRevision = null;
      await syncCurrentProject(pendingRev);
    }
  }

  window.addEventListener("pointermove", onConnectMove);
  window.addEventListener("pointerup", onConnectEnd);
  window.addEventListener("pointercancel", onConnectEnd);
}

function cancelDependencyConnectionVisuals() {
  const previewEl = document.getElementById("canvas-edge-preview");
  if (previewEl) {
    previewEl.style.display = "none";
    previewEl.removeAttribute("d");
  }
  document.querySelectorAll(".canvas-node.connecting-source").forEach(n => {
    n.classList.remove("connecting-source");
  });
  document.querySelectorAll(".canvas-node.drop-target").forEach(n => {
    n.classList.remove("drop-target");
  });
}

function cancelDependencyConnection() {
  state.canvas.isConnecting = false;
  state.canvas.connectSourceTaskId = null;
  cancelDependencyConnectionVisuals();
}

/**
 * Initiates canvas panning on primary drag (blank space), Space + drag, or middle mouse drag (Section 25-30).
 */
function startCanvasPan(startEvent) {
  const viewport = document.getElementById("canvas-viewport");
  if (!viewport) return;

  state.canvas.isPanning = true;
  viewport.classList.add("panning");

  const startPointerX = startEvent.clientX;
  const startPointerY = startEvent.clientY;
  const startPanX = state.canvas.camera.panX;
  const startPanY = state.canvas.camera.panY;
  let hasMoved = false;

  try {
    viewport.setPointerCapture(startEvent.pointerId);
  } catch (_) {}

  function onPanMove(moveEvent) {
    if (!state.canvas.isPanning) return;
    const dx = moveEvent.clientX - startPointerX;
    const dy = moveEvent.clientY - startPointerY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      hasMoved = true;
    }
    state.canvas.camera.panX = startPanX + dx;
    state.canvas.camera.panY = startPanY + dy;
    clampCanvasCamera();
    applyCanvasTransform();
  }

  function onPanEnd(endEvent) {
    window.removeEventListener("pointermove", onPanMove);
    window.removeEventListener("pointerup", onPanEnd);
    window.removeEventListener("pointercancel", onPanEnd);

    try {
      viewport.releasePointerCapture(endEvent.pointerId);
    } catch (_) {}

    state.canvas.isPanning = false;
    viewport.classList.remove("panning");

    if (hasMoved) {
      state.canvas.justPanned = true;
      setTimeout(() => {
        state.canvas.justPanned = false;
      }, 250);
    }

    if (!state.sync.isDragging && state.sync.deferred && state.sync.pendingRevision != null) {
      const pendingRev = state.sync.pendingRevision;
      state.sync.deferred = false;
      state.sync.pendingRevision = null;
      syncCurrentProject(pendingRev);
    }
  }

  window.addEventListener("pointermove", onPanMove);
  window.addEventListener("pointerup", onPanEnd);
  window.addEventListener("pointercancel", onPanEnd);
}

/**
 * Handles mouse wheel events for canvas panning and Ctrl/Cmd pointer-anchored zoom (Section 22-24).
 */
function onCanvasWheel(e) {
  if (e.target.closest(".modal-backdrop, .modal-card, input, textarea, select")) return;

  e.preventDefault();

  if (e.ctrlKey || e.metaKey) {
    // Zoom around pointer
    const zoomFactor = -e.deltaY * 0.002;
    const targetZoom = state.canvas.camera.zoom * (1 + zoomFactor);
    zoomCanvasAtPoint(targetZoom, e.clientX, e.clientY);
  } else {
    // Pan canvas with wheel / trackpad
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.shiftKey && dx === 0 && dy !== 0) {
      dx = dy;
      dy = 0;
    }

    state.canvas.camera.panX -= dx;
    state.canvas.camera.panY -= dy;
    clampCanvasCamera();
    applyCanvasTransform();
  }
}

/**
 * Handles double-click on blank canvas to trigger Quick Create (Section 60-65).
 */
function onCanvasDoubleClick(e) {
  if (state.canvas.justPanned || state.canvas.justConnected) return;
  if (!isBlankCanvasTarget(e.target)) return;

  const worldPos = screenToCanvasWorld(e.clientX, e.clientY);
  state.canvas.pendingCreatePosition = {
    x: Math.max(0, worldPos.x),
    y: Math.max(0, worldPos.y)
  };

  showInlineTaskBox();
}

/**
 * Initializes pan, zoom, and quick-create event bindings on the canvas viewport and controls.
 */
function initCanvasPanZoom() {
  const viewport = document.getElementById("canvas-viewport");
  if (!viewport) return;

  viewport.addEventListener("pointerdown", (e) => {
    const isMiddle = e.button === 1;
    const isPrimary = e.button === 0;
    const isBlank = isBlankCanvasTarget(e.target);
    const isSpacePan = isPrimary && state.canvas.spacePressed;

    if (isMiddle || isSpacePan || (isPrimary && isBlank)) {
      if (isBlank && state.canvas.selectedDependency) {
        state.canvas.selectedDependency = null;
        renderCanvasDependencies();
      }
      e.preventDefault();
      startCanvasPan(e);
    }
  });

  // Wheel handling for pan & pointer-anchored zoom (passive: false for preventDefault)
  viewport.addEventListener("wheel", onCanvasWheel, { passive: false });

  // Double click for Quick Create
  viewport.addEventListener("dblclick", onCanvasDoubleClick);

  // Zoom controls buttons
  const btnZoomOut = document.getElementById("btn-zoom-out");
  if (btnZoomOut) {
    btnZoomOut.addEventListener("click", (e) => {
      e.stopPropagation();
      zoomCanvasCenter(-CANVAS_ZOOM_STEP);
    });
  }

  const btnZoomIn = document.getElementById("btn-zoom-in");
  if (btnZoomIn) {
    btnZoomIn.addEventListener("click", (e) => {
      e.stopPropagation();
      zoomCanvasCenter(CANVAS_ZOOM_STEP);
    });
  }

  const btnFitTasks = document.getElementById("btn-fit-tasks");
  if (btnFitTasks) {
    btnFitTasks.addEventListener("click", (e) => {
      e.stopPropagation();
      fitCanvasTasks();
    });
  }

  const zoomLabel = document.getElementById("canvas-zoom-label");
  if (zoomLabel) {
    zoomLabel.addEventListener("click", (e) => {
      e.stopPropagation();
      // Reset zoom to 100% centered in viewport
      const vp = document.getElementById("canvas-viewport");
      if (vp) {
        const rect = vp.getBoundingClientRect();
        zoomCanvasAtPoint(1.0, rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
    });
  }

  // Prevent zoom controls and empty card from initiating pan / quick create
  const zoomControls = document.getElementById("canvas-zoom-controls");
  if (zoomControls) {
    zoomControls.addEventListener("pointerdown", (e) => e.stopPropagation());
    zoomControls.addEventListener("mousedown", (e) => e.stopPropagation());
    zoomControls.addEventListener("dblclick", (e) => e.stopPropagation());
  }

  const emptyCard = document.querySelector(".canvas-empty-card");
  if (emptyCard) {
    emptyCard.addEventListener("pointerdown", (e) => e.stopPropagation());
    emptyCard.addEventListener("mousedown", (e) => e.stopPropagation());
    emptyCard.addEventListener("dblclick", (e) => e.stopPropagation());
  }

  // Contextual edge delete button
  const deleteEdgeBtn = document.getElementById("canvas-edge-delete-btn");
  if (deleteEdgeBtn) {
    deleteEdgeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    deleteEdgeBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    deleteEdgeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!state.canvas.selectedDependency) return;
      openDeleteDependencyModal(
        state.canvas.selectedDependency.from_task_id,
        state.canvas.selectedDependency.to_task_id
      );
    });
  }

  // Confirmation modal delete action
  const confirmDeleteDepBtn = document.getElementById("btn-confirm-delete-dependency");
  if (confirmDeleteDepBtn) {
    confirmDeleteDepBtn.addEventListener("click", async () => {
      if (!state.canvas.pendingDeleteDependency) return;
      const { from_task_id, to_task_id } = state.canvas.pendingDeleteDependency;
      closeModal("modal-delete-dependency");
      await deleteTaskDependency(from_task_id, to_task_id);
      state.canvas.pendingDeleteDependency = null;
    });
  }

  // Canvas empty overlay buttons
  const emptyAddBtn = document.getElementById("canvas-empty-add-btn");
  if (emptyAddBtn) {
    emptyAddBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.canvas.pendingCreatePosition = null;
      showInlineTaskBox();
    });
  }

  const emptyClearBtn = document.getElementById("canvas-empty-clear-btn");
  if (emptyClearBtn) {
    emptyClearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      resetFilters();
      renderTasks();
    });
  }

  // Initialize Canvas Minimap interactions (Section 39 - 54)
  initCanvasMinimap();
}

/**
 * Keyboard shortcuts for Space pan, keyboard zoom (+, -), and fit (0) (Section 57-59).
 */
function setupCanvasKeyboard() {
  window.addEventListener("keydown", (e) => {
    // If typing inside an input, textarea, or contenteditable, ignore completely
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable)) {
      return;
    }

    // Only active when on project screen and canvas view is visible
    if (state.screen !== "project" || state.view !== "canvas") return;

    if (e.code === "Space" || e.key === " ") {
      if (!state.canvas.spacePressed) {
        state.canvas.spacePressed = true;
        const viewport = document.getElementById("canvas-viewport");
        if (viewport) viewport.classList.add("space-held");
      }
      e.preventDefault();
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomCanvasCenter(CANVAS_ZOOM_STEP);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomCanvasCenter(-CANVAS_ZOOM_STEP);
    } else if (e.key === "0") {
      e.preventDefault();
      fitCanvasTasks();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (state.canvas.selectedDependency && !state.activeModal) {
        e.preventDefault();
        openDeleteDependencyModal(
          state.canvas.selectedDependency.from_task_id,
          state.canvas.selectedDependency.to_task_id
        );
      }
    } else if (e.key === "Escape") {
      if (state.canvas.isConnecting) {
        e.preventDefault();
        cancelDependencyConnection();
      } else if (state.canvas.selectedDependency && !state.activeModal) {
        e.preventDefault();
        state.canvas.selectedDependency = null;
        renderCanvasDependencies();
      }
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "Space" || e.key === " ") {
      state.canvas.spacePressed = false;
      const viewport = document.getElementById("canvas-viewport");
      if (viewport) {
        viewport.classList.remove("space-held");
      }
    }
  });

  window.addEventListener("blur", () => {
    state.canvas.spacePressed = false;
    state.canvas.isPanning = false;
    state.canvas.justPanned = false;
    cancelDependencyConnection();
    const viewport = document.getElementById("canvas-viewport");
    if (viewport) {
      viewport.classList.remove("space-held");
      viewport.classList.remove("panning");
    }
  });
}

// =====================================================================
// 12C. CANVAS MINIMAP (Spatial Overview & Viewport Navigation)
// =====================================================================

let currentMinimapTransform = null;

/**
 * Computes centralized geometry transform for Canvas Minimap (Section 23 - 33).
 * Covers visible tasks bounds + current viewport world rectangle + padding.
 * Preserves aspect ratio with letterboxing and guarantees minimum world span.
 */
function getMinimapTransform(visibleTasks) {
  const viewport = document.getElementById("canvas-viewport");
  const minimapEl = document.getElementById("canvas-minimap");
  if (!viewport || !minimapEl) return null;

  const vWidth = viewport.clientWidth || 1200;
  const vHeight = viewport.clientHeight || 800;
  const miniWidth = minimapEl.clientWidth || 180;
  const miniHeight = minimapEl.clientHeight || 120;
  const { panX, panY, zoom } = state.canvas.camera;

  // Derive visible world rectangle in Canvas viewport (Section 26, 27)
  const worldLeft = -panX / zoom;
  const worldTop = -panY / zoom;
  const worldWidth = vWidth / zoom;
  const worldHeight = vHeight / zoom;
  const worldRight = worldLeft + worldWidth;
  const worldBottom = worldTop + worldHeight;

  // Calculate bounding extent covering both visible tasks and viewport (Section 25)
  let minX = worldLeft;
  let minY = worldTop;
  let maxX = worldRight;
  let maxY = worldBottom;

  if (visibleTasks && visibleTasks.length > 0) {
    visibleTasks.forEach(task => {
      const bounds = getCanvasNodeBounds(task.id);
      if (bounds.x < minX) minX = bounds.x;
      if (bounds.y < minY) minY = bounds.y;
      if (bounds.x + bounds.width > maxX) maxX = bounds.x + bounds.width;
      if (bounds.y + bounds.height > maxY) maxY = bounds.y + bounds.height;
    });
  }

  // Bounds padding (Section 28)
  const PADDING = 120;
  minX -= PADDING;
  minY -= PADDING;
  maxX += PADDING;
  maxY += PADDING;

  // Minimum world span to avoid extreme scaling for single/clustered tasks (Section 82, 83)
  const MIN_SPAN_W = 1400;
  const MIN_SPAN_H = 900;
  let totalW = maxX - minX;
  let totalH = maxY - minY;

  if (totalW < MIN_SPAN_W) {
    const diff = (MIN_SPAN_W - totalW) / 2;
    minX -= diff;
    maxX += diff;
    totalW = MIN_SPAN_W;
  }
  if (totalH < MIN_SPAN_H) {
    const diff = (MIN_SPAN_H - totalH) / 2;
    minY -= diff;
    maxY += diff;
    totalH = MIN_SPAN_H;
  }

  // Aspect ratio preservation with letterboxing (Section 29, 30)
  const scale = Math.min(miniWidth / totalW, miniHeight / totalH);
  const fittedW = totalW * scale;
  const fittedH = totalH * scale;
  const offsetX = (miniWidth - fittedW) / 2;
  const offsetY = (miniHeight - fittedH) / 2;

  return {
    worldMinX: minX,
    worldMinY: minY,
    worldMaxX: maxX,
    worldMaxY: maxY,
    worldWidth: totalW,
    worldHeight: totalH,
    miniWidth,
    miniHeight,
    scale,
    offsetX,
    offsetY,
    viewportWorld: {
      left: worldLeft,
      top: worldTop,
      right: worldRight,
      bottom: worldBottom,
      width: worldWidth,
      height: worldHeight
    }
  };
}

/**
 * Converts world coordinates to Minimap coordinates (Section 31).
 */
function worldToMinimap(worldX, worldY, transform) {
  const t = transform || currentMinimapTransform;
  if (!t) return { x: 0, y: 0 };
  return {
    x: (worldX - t.worldMinX) * t.scale + t.offsetX,
    y: (worldY - t.worldMinY) * t.scale + t.offsetY
  };
}

/**
 * Converts Minimap coordinates to world coordinates (Section 32).
 */
function minimapToWorld(miniX, miniY, transform) {
  const t = transform || currentMinimapTransform;
  if (!t) return { x: 0, y: 0 };
  return {
    x: (miniX - t.offsetX) / t.scale + t.worldMinX,
    y: (miniY - t.offsetY) / t.scale + t.worldMinY
  };
}

/**
 * Centers the main Canvas camera on the specified world coordinate while preserving zoom (Section 40, 41, 42).
 * Zero network requests, zero task mutations, zero project revisions.
 */
function centerCanvasOnWorldPoint(targetWorldX, targetWorldY) {
  const viewport = document.getElementById("canvas-viewport");
  const vWidth = viewport ? viewport.clientWidth : 1200;
  const vHeight = viewport ? viewport.clientHeight : 800;
  const zoom = state.canvas.camera.zoom;

  state.canvas.camera.panX = Math.round(vWidth / 2 - targetWorldX * zoom);
  state.canvas.camera.panY = Math.round(vHeight / 2 - targetWorldY * zoom);

  clampCanvasCamera();
  applyCanvasTransform();
}

/**
 * Renders the visible task markers in the Minimap SVG (Section 14 - 20, 36 - 38).
 */
function renderCanvasMinimap(visibleTasks) {
  const minimapEl = document.getElementById("canvas-minimap");
  const tasksGroup = document.getElementById("minimap-tasks-group");
  if (!minimapEl || !tasksGroup) return;

  // Hide minimap if not in project canvas view or if 0 visible tasks (Section 80, 81, 87)
  if (state.screen !== "project" || state.view !== "canvas" || !visibleTasks || visibleTasks.length === 0) {
    minimapEl.style.display = "none";
    tasksGroup.innerHTML = "";
    currentMinimapTransform = null;
    return;
  }

  minimapEl.style.display = "block";
  currentMinimapTransform = getMinimapTransform(visibleTasks);
  if (!currentMinimapTransform) return;

  tasksGroup.innerHTML = "";

  visibleTasks.forEach(task => {
    const bounds = getCanvasNodeBounds(task.id);
    const miniPos = worldToMinimap(bounds.x, bounds.y, currentMinimapTransform);
    const miniW = Math.max(4, Math.min(30, Math.round(bounds.width * currentMinimapTransform.scale)));
    const miniH = Math.max(3, Math.min(20, Math.round(bounds.height * currentMinimapTransform.scale)));

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", `minimap-task-node minimap-status-${task.status.toLowerCase()}`);
    rect.id = `minimap-task-${task.id}`;
    rect.dataset.taskId = String(task.id);
    rect.setAttribute("x", Math.round(miniPos.x * 10) / 10);
    rect.setAttribute("y", Math.round(miniPos.y * 10) / 10);
    rect.setAttribute("width", miniW);
    rect.setAttribute("height", miniH);
    rect.setAttribute("rx", "1");
    rect.setAttribute("ry", "1");

    tasksGroup.appendChild(rect);
  });

  updateMinimapViewport();
}

/**
 * Updates the minimap viewport indicator rectangle live without re-rendering task nodes (Section 21, 22, 55, 97, 98).
 */
function updateMinimapViewport() {
  const minimapEl = document.getElementById("canvas-minimap");
  const viewportRect = document.getElementById("minimap-viewport-rect");
  if (!minimapEl || !viewportRect || minimapEl.style.display === "none") return;

  const visibleTasks = getVisibleTasks();
  if (!visibleTasks || visibleTasks.length === 0) {
    minimapEl.style.display = "none";
    return;
  }

  const viewport = document.getElementById("canvas-viewport");
  if (!viewport) return;
  const vWidth = viewport.clientWidth || 1200;
  const vHeight = viewport.clientHeight || 800;
  const { panX, panY, zoom } = state.canvas.camera;
  const worldLeft = -panX / zoom;
  const worldTop = -panY / zoom;
  const worldRight = worldLeft + vWidth / zoom;
  const worldBottom = worldTop + vHeight / zoom;

  // If camera viewport expanded outside existing minimap bounds, recompute bounds (Section 79, 99)
  if (
    !currentMinimapTransform ||
    worldLeft < currentMinimapTransform.worldMinX ||
    worldRight > currentMinimapTransform.worldMaxX ||
    worldTop < currentMinimapTransform.worldMinY ||
    worldBottom > currentMinimapTransform.worldMaxY
  ) {
    currentMinimapTransform = getMinimapTransform(visibleTasks);
    if (!currentMinimapTransform) return;
    const tasksGroup = document.getElementById("minimap-tasks-group");
    if (tasksGroup) {
      visibleTasks.forEach(task => {
        const rect = document.getElementById(`minimap-task-${task.id}`);
        if (rect) {
          const bounds = getCanvasNodeBounds(task.id);
          const miniPos = worldToMinimap(bounds.x, bounds.y, currentMinimapTransform);
          const miniW = Math.max(4, Math.min(30, Math.round(bounds.width * currentMinimapTransform.scale)));
          const miniH = Math.max(3, Math.min(20, Math.round(bounds.height * currentMinimapTransform.scale)));
          rect.setAttribute("x", Math.round(miniPos.x * 10) / 10);
          rect.setAttribute("y", Math.round(miniPos.y * 10) / 10);
          rect.setAttribute("width", miniW);
          rect.setAttribute("height", miniH);
        }
      });
    }
  }

  const vpPos = worldToMinimap(worldLeft, worldTop, currentMinimapTransform);
  const vpW = (vWidth / zoom) * currentMinimapTransform.scale;
  const vpH = (vHeight / zoom) * currentMinimapTransform.scale;

  viewportRect.setAttribute("x", Math.round(vpPos.x * 10) / 10);
  viewportRect.setAttribute("y", Math.round(vpPos.y * 10) / 10);
  viewportRect.setAttribute("width", Math.max(4, Math.round(vpW * 10) / 10));
  viewportRect.setAttribute("height", Math.max(4, Math.round(vpH * 10) / 10));
}

/**
 * Updates a single task node's position in the Minimap during canvas node dragging (Section 95, 96).
 */
function updateMinimapTaskPosition(taskId, newWorldX, newWorldY) {
  if (!currentMinimapTransform) return;
  const rect = document.getElementById(`minimap-task-${taskId}`);
  if (!rect) return;

  const miniPos = worldToMinimap(newWorldX, newWorldY, currentMinimapTransform);
  rect.setAttribute("x", Math.round(miniPos.x * 10) / 10);
  rect.setAttribute("y", Math.round(miniPos.y * 10) / 10);
}

/**
 * Initializes Minimap pointer events (click-to-navigate and viewport drag) (Section 39 - 54).
 */
function initCanvasMinimap() {
  const minimapEl = document.getElementById("canvas-minimap");
  const svgEl = document.getElementById("canvas-minimap-svg");
  const viewportRect = document.getElementById("minimap-viewport-rect");
  if (!minimapEl || !svgEl || !viewportRect) return;

  // Prevent double click, middle click, context menu from bubbling to viewport (Section 53, 54, 129)
  minimapEl.addEventListener("dblclick", (e) => e.stopPropagation());
  minimapEl.addEventListener("mousedown", (e) => e.stopPropagation());
  minimapEl.addEventListener("pointerdown", (e) => e.stopPropagation());
  minimapEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  let isDraggingViewport = false;
  let dragMoved = false;
  let startPointerX = 0;
  let startPointerY = 0;
  let startPanX = 0;
  let startPanY = 0;
  let dragTransformScale = 1;
  let dragCameraZoom = 1;

  // 1. Dragging the viewport indicator rectangle (Section 44 - 49)
  viewportRect.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (state.canvas.isConnecting) return; // Disabled during active edge connection (Section 188)

    e.preventDefault();
    e.stopPropagation();

    try {
      viewportRect.setPointerCapture(e.pointerId);
    } catch (_) {}

    isDraggingViewport = true;
    dragMoved = false;
    state.canvas.minimap.isDraggingViewport = true;
    startPointerX = e.clientX;
    startPointerY = e.clientY;
    startPanX = state.canvas.camera.panX;
    startPanY = state.canvas.camera.panY;
    dragTransformScale = (currentMinimapTransform && currentMinimapTransform.scale) ? currentMinimapTransform.scale : 0.1;
    dragCameraZoom = state.canvas.camera.zoom || 1.0;

    viewportRect.classList.add("dragging");
  });

  viewportRect.addEventListener("pointermove", (e) => {
    if (!isDraggingViewport) return;

    const deltaX = e.clientX - startPointerX;
    const deltaY = e.clientY - startPointerY;

    if (!dragMoved && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
      dragMoved = true;
    }

    if (dragMoved) {
      // Direct drag math (Section 45, 46):
      // Delta in minimap maps to delta in world: deltaWorld = deltaMini / scale
      // Pan decreases as visible world shifts in the drag direction: pan -= deltaWorld * zoom
      const deltaWorldX = deltaX / dragTransformScale;
      const deltaWorldY = deltaY / dragTransformScale;

      state.canvas.camera.panX = Math.round(startPanX - deltaWorldX * dragCameraZoom);
      state.canvas.camera.panY = Math.round(startPanY - deltaWorldY * dragCameraZoom);

      clampCanvasCamera();
      applyCanvasTransform();
    }
  });

  function stopViewportDrag(e) {
    if (!isDraggingViewport) return;

    try {
      viewportRect.releasePointerCapture(e.pointerId);
    } catch (_) {}

    isDraggingViewport = false;
    state.canvas.minimap.isDraggingViewport = false;
    viewportRect.classList.remove("dragging");

    if (!dragMoved) {
      // User clicked directly on viewport indicator without moving -> center on clicked point (Section 49)
      const rect = svgEl.getBoundingClientRect();
      const miniX = e.clientX - rect.left;
      const miniY = e.clientY - rect.top;
      if (currentMinimapTransform) {
        const targetWorld = minimapToWorld(miniX, miniY, currentMinimapTransform);
        centerCanvasOnWorldPoint(targetWorld.x, targetWorld.y);
      }
    }
  }

  viewportRect.addEventListener("pointerup", stopViewportDrag);
  viewportRect.addEventListener("pointercancel", stopViewportDrag);

  // 2. Click on minimap overview to center canvas (Section 39 - 43, 50)
  svgEl.addEventListener("pointerdown", (e) => {
    if (e.target === viewportRect) return; // Handled by viewportRect
    if (e.button !== 0) return;
    if (state.canvas.isConnecting) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = svgEl.getBoundingClientRect();
    const miniX = e.clientX - rect.left;
    const miniY = e.clientY - rect.top;

    if (currentMinimapTransform) {
      const targetWorld = minimapToWorld(miniX, miniY, currentMinimapTransform);
      centerCanvasOnWorldPoint(targetWorld.x, targetWorld.y);
    }
  });
}

// =====================================================================
// 13. KEYBOARD UX & EVENT LISTENERS
// =====================================================================

function setupEventListeners() {
  // Logout
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      stopProjectSync();
      await api.post("/api/logout", {});
      window.location.href = "/";
    });
  }

  // Handle tab visibility changes (pauses sync when tab hidden, checks immediately when visible)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (state.sync.timerId) {
        clearTimeout(state.sync.timerId);
        state.sync.timerId = null;
      }
    } else if (document.visibilityState === "visible") {
      if (state.screen === "project" && state.selectedProjectId) {
        pollProjectRevision();
      }
    }
  });

  // Handle window / viewport resize for Canvas Minimap (Section 84 - 86)
  window.addEventListener("resize", () => {
    if (state.screen === "project" && state.view === "canvas") {
      updateMinimapViewport();
    }
  });

  // Sidebar Dashboard Navigation Item
  const navDashboardBtn = document.getElementById("nav-dashboard-btn");
  if (navDashboardBtn) {
    navDashboardBtn.addEventListener("click", () => {
      openDashboard();
    });
  }

  // Sidebar Inline Project Creator Form
  const newProjectToggleBtn = document.getElementById("new-project-toggle-btn");
  if (newProjectToggleBtn) {
    newProjectToggleBtn.addEventListener("click", showInlineProjectForm);
  }

  const cancelProjectBtn = document.getElementById("cancel-project-btn");
  if (cancelProjectBtn) {
    cancelProjectBtn.addEventListener("click", hideInlineProjectForm);
  }

  const createProjectForm = document.getElementById("create-project-form");
  if (createProjectForm) {
    createProjectForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("new-project-name");
      if (input) createProject(input.value);
    });
  }

  const emptyCreateProjectBtn = document.getElementById("empty-create-project-btn");
  if (emptyCreateProjectBtn) {
    emptyCreateProjectBtn.addEventListener("click", showInlineProjectForm);
  }

  // Dashboard Export Data Button
  const dashboardExportBtn = document.getElementById("dashboard-export-btn");
  if (dashboardExportBtn) {
    dashboardExportBtn.addEventListener("click", () => {
      exportAllDataJson();
    });
  }

  // Dashboard Create Project Buttons
  const dashboardNewProjectBtn = document.getElementById("dashboard-new-project-btn");
  if (dashboardNewProjectBtn) {
    dashboardNewProjectBtn.addEventListener("click", showInlineProjectForm);
  }

  const dashboardCreateFirstProjectBtn = document.getElementById("dashboard-create-first-project-btn");
  if (dashboardCreateFirstProjectBtn) {
    dashboardCreateFirstProjectBtn.addEventListener("click", showInlineProjectForm);
  }

  // Dashboard Retry Button
  const dashboardRetryBtn = document.getElementById("dashboard-retry-btn");
  if (dashboardRetryBtn) {
    dashboardRetryBtn.addEventListener("click", () => {
      loadDashboard();
    });
  }

  // View Switcher Buttons (Kanban first, List second)
  const tabKanban = document.getElementById("view-tab-kanban");
  if (tabKanban) {
    tabKanban.addEventListener("click", () => switchView("kanban"));
  }

  const tabList = document.getElementById("view-tab-list");
  if (tabList) {
    tabList.addEventListener("click", () => switchView("list"));
  }

  const tabCanvas = document.getElementById("view-tab-canvas");
  if (tabCanvas) {
    tabCanvas.addEventListener("click", () => switchView("canvas"));
  }

  // Search Input & Clear Search
  const searchInput = document.getElementById("task-search-input");
  const searchClearBtn = document.getElementById("task-search-clear");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      if (searchClearBtn) {
        searchClearBtn.style.display = state.searchQuery.trim() ? "block" : "none";
      }
      cancelDependencyConnection();
      renderTasks();
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        state.searchQuery = "";
        searchInput.value = "";
        if (searchClearBtn) searchClearBtn.style.display = "none";
        cancelDependencyConnection();
        renderTasks();
      }
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener("click", () => {
      state.searchQuery = "";
      if (searchInput) {
        searchInput.value = "";
        searchInput.focus();
      }
      searchClearBtn.style.display = "none";
      cancelDependencyConnection();
      renderTasks();
    });
  }

  // Status Filter
  const statusFilterSelect = document.getElementById("filter-status");
  if (statusFilterSelect) {
    statusFilterSelect.addEventListener("change", (e) => {
      state.statusFilter = e.target.value;
      cancelDependencyConnection();
      renderTasks();
    });
  }

  // Due Date Filter
  const dueFilterSelect = document.getElementById("filter-due");
  if (dueFilterSelect) {
    dueFilterSelect.addEventListener("change", (e) => {
      state.dueFilter = e.target.value;
      cancelDependencyConnection();
      renderTasks();
    });
  }

  // Assignee Filter
  const assigneeFilterSelect = document.getElementById("filter-assignee");
  if (assigneeFilterSelect) {
    assigneeFilterSelect.addEventListener("change", (e) => {
      state.assigneeFilter = e.target.value;
      cancelDependencyConnection();
      renderTasks();
    });
  }

  // My Tasks Shortcut Button (Section 13, 15, 16)
  const myTasksBtn = document.getElementById("btn-my-tasks");
  if (myTasksBtn) {
    myTasksBtn.addEventListener("click", () => {
      if (state.assigneeFilter === "me") {
        state.assigneeFilter = "all";
      } else {
        state.assigneeFilter = "me";
      }
      cancelDependencyConnection();
      renderTasks();
    });
  }

  // Clear Filters Buttons (Toolbar button + Empty state button)
  const clearFiltersBtn = document.getElementById("btn-clear-filters");
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", () => {
      resetFilters();
      renderTasks();
    });
  }

  const filterEmptyClearBtn = document.getElementById("filter-empty-clear-btn");
  if (filterEmptyClearBtn) {
    filterEmptyClearBtn.addEventListener("click", () => {
      resetFilters();
      renderTasks();
    });
  }

  // Project Header Context Menu
  const projectMenuBtn = document.getElementById("project-menu-btn");
  if (projectMenuBtn) {
    projectMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleProjectMenu();
    });
  }

  const menuProjectMembers = document.getElementById("menu-project-members");
  if (menuProjectMembers) {
    menuProjectMembers.addEventListener("click", () => {
      closeProjectMenu();
      openMembersModal(state.selectedProjectId);
    });
  }

  const projectMembersBtn = document.getElementById("project-members-btn");
  if (projectMembersBtn) {
    projectMembersBtn.addEventListener("click", () => {
      openMembersModal(state.selectedProjectId);
    });
  }

  const menuRenameProject = document.getElementById("menu-rename-project");
  if (menuRenameProject) {
    menuRenameProject.addEventListener("click", () => openRenameProjectModal());
  }

  const menuExportCsv = document.getElementById("menu-export-project-csv");
  if (menuExportCsv) {
    menuExportCsv.addEventListener("click", () => exportCurrentProjectCsv());
  }

  const menuExportJson = document.getElementById("menu-export-all-json");
  if (menuExportJson) {
    menuExportJson.addEventListener("click", () => exportAllDataJson());
  }

  const menuDeleteProject = document.getElementById("menu-delete-project");
  if (menuDeleteProject) {
    menuDeleteProject.addEventListener("click", () => openDeleteProjectModal());
  }

  // Close menus when clicking outside
  document.addEventListener("click", (e) => {
    const projectMenu = document.getElementById("project-menu");
    const projectMenuBtn = document.getElementById("project-menu-btn");
    if (projectMenu && !projectMenu.contains(e.target) && e.target !== projectMenuBtn) {
      closeProjectMenu();
    }
    const contextMenu = document.getElementById("global-context-menu");
    if (contextMenu && !contextMenu.contains(e.target) && !e.target.closest(".project-item-menu-btn")) {
      closeGlobalContextMenu();
    }
  });

  // Fast Add Task UI (Toolbar & Empty State)
  const toolbarAddTaskBtn = document.getElementById("toolbar-add-task-btn");
  if (toolbarAddTaskBtn) {
    toolbarAddTaskBtn.addEventListener("click", () => {
      state.canvas.pendingCreatePosition = null;
      showInlineTaskBox();
    });
  }

  const emptyAddTaskBtn = document.getElementById("empty-add-task-btn");
  if (emptyAddTaskBtn) {
    emptyAddTaskBtn.addEventListener("click", () => {
      state.canvas.pendingCreatePosition = null;
      showInlineTaskBox();
    });
  }

  const fastTaskCancelBtn = document.getElementById("fast-task-cancel-btn");
  if (fastTaskCancelBtn) {
    fastTaskCancelBtn.addEventListener("click", hideInlineTaskBox);
  }

  const fastTaskForm = document.getElementById("fast-task-form");
  if (fastTaskForm) {
    fastTaskForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const titleInput = document.getElementById("fast-task-title");
      const descInput = document.getElementById("fast-task-description");
      const dueInput = document.getElementById("fast-task-due-date");
      const assigneeInput = document.getElementById("fast-task-assignee");
      if (titleInput) {
        createTask(
          titleInput.value,
          descInput ? descInput.value : "",
          dueInput ? dueInput.value : null,
          assigneeInput ? assigneeInput.value : null
        );
      }
    });
  }

  // Title input keyboard handling
  const fastTaskTitle = document.getElementById("fast-task-title");
  if (fastTaskTitle) {
    fastTaskTitle.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hideInlineTaskBox();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const descInput = document.getElementById("fast-task-description");
        const dueInput = document.getElementById("fast-task-due-date");
        const assigneeInput = document.getElementById("fast-task-assignee");
        createTask(
          fastTaskTitle.value,
          descInput ? descInput.value : "",
          dueInput ? dueInput.value : null,
          assigneeInput ? assigneeInput.value : null
        );
      }
    });
  }

  // Due date input keyboard handling
  const fastTaskDueDate = document.getElementById("fast-task-due-date");
  if (fastTaskDueDate) {
    fastTaskDueDate.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hideInlineTaskBox();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const titleInput = document.getElementById("fast-task-title");
        const descInput = document.getElementById("fast-task-description");
        const assigneeInput = document.getElementById("fast-task-assignee");
        if (titleInput) {
          createTask(
            titleInput.value,
            descInput ? descInput.value : "",
            fastTaskDueDate.value,
            assigneeInput ? assigneeInput.value : null
          );
        }
      }
    });
  }

  // Description textarea keyboard handling:
  // Enter alone inserts newline.
  // Ctrl+Enter or Cmd+Enter submits the form.
  // Escape cancels/closes the form.
  const fastTaskDesc = document.getElementById("fast-task-description");
  if (fastTaskDesc) {
    fastTaskDesc.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hideInlineTaskBox();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const titleInput = document.getElementById("fast-task-title");
        const dueInput = document.getElementById("fast-task-due-date");
        const assigneeInput = document.getElementById("fast-task-assignee");
        if (titleInput) {
          createTask(
            titleInput.value,
            fastTaskDesc.value,
            dueInput ? dueInput.value : null,
            assigneeInput ? assigneeInput.value : null
          );
        }
      }
    });
  }

  // Edit task description textarea keyboard handling (Ctrl+Enter to save)
  const editTaskDesc = document.getElementById("input-edit-task-desc");
  if (editTaskDesc) {
    editTaskDesc.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const form = document.getElementById("form-edit-task");
        if (form) form.requestSubmit();
      }
    });
  }

  // Escape key handler on new project input
  const newProjectInput = document.getElementById("new-project-name");
  if (newProjectInput) {
    newProjectInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hideInlineProjectForm();
      }
    });
  }

  // Modal Cancel & Close buttons
  document.querySelectorAll("[data-modal]").forEach(btn => {
    btn.addEventListener("click", () => {
      const modalId = btn.getAttribute("data-modal");
      closeModal(modalId);
    });
  });

  // Backdrop click closes non-destructive dialogs
  document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        // Do NOT dismiss destructive confirmation dialogs on accidental backdrop click
        if (backdrop.id !== "modal-delete-project" && backdrop.id !== "modal-delete-task") {
          closeModal(backdrop.id);
        }
      }
    });
  });

  // Global Escape key to dismiss modals or popovers
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (state.activeModal) {
        closeModal(state.activeModal);
      }
      closeProjectMenu();
      closeGlobalContextMenu();
    }
  });

  // Modal Form: Rename Project
  const formRenameProject = document.getElementById("form-rename-project");
  if (formRenameProject) {
    formRenameProject.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("input-rename-project");
      if (input && state.selectedProjectId) {
        renameProject(state.selectedProjectId, input.value);
      }
    });
  }

  // Modal Action: Confirm Delete Project
  const btnConfirmDeleteProject = document.getElementById("btn-confirm-delete-project");
  if (btnConfirmDeleteProject) {
    btnConfirmDeleteProject.addEventListener("click", () => {
      if (state.pendingDeleteProjectId) {
        deleteProject(state.pendingDeleteProjectId);
      }
    });
  }

  // Modal Form: Edit Task (Title + Description + Status + Due Date + Assignee)
  const formEditTask = document.getElementById("form-edit-task");
  if (formEditTask) {
    formEditTask.addEventListener("submit", (e) => {
      e.preventDefault();
      const titleInput = document.getElementById("input-edit-task-title");
      const descInput = document.getElementById("input-edit-task-desc");
      const statusSelect = document.getElementById("select-edit-task-status");
      const dueInput = document.getElementById("input-edit-task-due");
      const assigneeSelect = document.getElementById("select-edit-task-assignee");

      if (titleInput && statusSelect && state.editingTaskId) {
        const titleVal = titleInput.value.trim();
        const descVal = descInput ? descInput.value.trim() : "";
        const statusVal = statusSelect.value;
        const dueVal = (dueInput && dueInput.value) ? dueInput.value.trim() : "";
        const assigneeVal = (assigneeSelect && assigneeSelect.value) ? parseInt(assigneeSelect.value, 10) : null;

        const snap = state.taskModalSnapshot || {};
        const snapAssignee = snap.assignee_id ? parseInt(snap.assignee_id, 10) : null;

        const updates = {};
        if (titleVal !== snap.title) updates.title = titleVal;
        if (descVal !== snap.description) updates.description = descVal;
        if (statusVal !== snap.status) updates.status = statusVal;
        if (dueVal !== snap.due_date) updates.due_date = dueVal || null;
        if (assigneeVal !== snapAssignee) updates.assignee_id = assigneeVal;

        if (Object.keys(updates).length === 0) {
          // No fields were modified by the user
          closeModal("modal-edit-task");
          return;
        }

        updateTask(state.editingTaskId, updates);
      }
    });
  }

  // Modal Action: Confirm Delete Task
  const btnConfirmDeleteTask = document.getElementById("btn-confirm-delete-task");
  if (btnConfirmDeleteTask) {
    btnConfirmDeleteTask.addEventListener("click", () => {
      if (state.pendingDeleteTaskId) {
        deleteTask(state.pendingDeleteTaskId);
      }
    });
  }

  // Join Project Openers
  const sidebarJoinBtn = document.getElementById("sidebar-join-project-btn");
  if (sidebarJoinBtn) {
    sidebarJoinBtn.addEventListener("click", openJoinProjectModal);
  }

  const emptyJoinBtn = document.getElementById("empty-join-project-btn");
  if (emptyJoinBtn) {
    emptyJoinBtn.addEventListener("click", openJoinProjectModal);
  }

  const dashboardJoinBtn = document.getElementById("dashboard-join-project-btn");
  if (dashboardJoinBtn) {
    dashboardJoinBtn.addEventListener("click", openJoinProjectModal);
  }

  const dashboardJoinFirstBtn = document.getElementById("dashboard-join-first-project-btn");
  if (dashboardJoinFirstBtn) {
    dashboardJoinFirstBtn.addEventListener("click", openJoinProjectModal);
  }

  // Join Project Modal Form
  const formJoinProject = document.getElementById("form-join-project");
  if (formJoinProject) {
    formJoinProject.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("input-join-code");
      if (input) {
        joinProject(input.value);
      }
    });
  }

  const inputJoinCode = document.getElementById("input-join-code");
  if (inputJoinCode) {
    inputJoinCode.addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase();
      const errEl = document.getElementById("join-project-error");
      if (errEl) errEl.style.display = "none";
    });
  }

  // Members Modal Actions
  const btnCopyJoinCode = document.getElementById("btn-copy-join-code");
  if (btnCopyJoinCode) {
    btnCopyJoinCode.addEventListener("click", copyJoinCode);
  }

  const btnRegenPrompt = document.getElementById("btn-regenerate-code-prompt");
  if (btnRegenPrompt) {
    btnRegenPrompt.addEventListener("click", openConfirmRegenerateCodeModal);
  }

  const btnConfirmRegen = document.getElementById("btn-confirm-regenerate-code");
  if (btnConfirmRegen) {
    btnConfirmRegen.addEventListener("click", regenerateJoinCode);
  }

  const btnConfirmRemoveMember = document.getElementById("btn-confirm-remove-member");
  if (btnConfirmRemoveMember) {
    btnConfirmRemoveMember.addEventListener("click", removeMember);
  }

  // Task Comments Listeners
  const btnPostComment = document.getElementById("btn-post-comment");
  if (btnPostComment) {
    btnPostComment.addEventListener("click", postTaskComment);
  }

  const taskCommentInput = document.getElementById("task-comment-input");
  if (taskCommentInput) {
    taskCommentInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        postTaskComment();
      }
    });
  }

  const btnConfirmDeleteComment = document.getElementById("btn-confirm-delete-comment");
  if (btnConfirmDeleteComment) {
    btnConfirmDeleteComment.addEventListener("click", confirmDeleteComment);
  }

  // Canvas View Pan, Zoom, and Keyboard Listeners
  initCanvasPanZoom();
  setupCanvasKeyboard();
}

// =====================================================================
// 14. INITIALIZATION
// =====================================================================
async function initApp() {
  // 1. Verify user authentication session
  const meRes = await api.get("/api/me");
  if (!meRes || !meRes.ok) {
    window.location.href = "/";
    return;
  }

  state.currentUser = meRes.data.data;
  const usernameEl = document.getElementById("current-username");
  if (usernameEl) {
    usernameEl.textContent = state.currentUser.username;
  }

  // 2. Setup DOM event listeners & native drag-and-drop
  setupEventListeners();
  setupDragAndDrop();

  // 3. Open Dashboard as default landing screen on fresh load / login
  await openDashboard();
}

// Start application when DOM is ready
document.addEventListener("DOMContentLoaded", initApp);

