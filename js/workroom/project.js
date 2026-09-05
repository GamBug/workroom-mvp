/**
 * js/workroom/project.js - Project Domain Actions, Dashboard, Collaboration, and Sidebar
 *
 * Responsibilities:
 * - Dashboard metrics calculation, attention list, and project overview rendering.
 * - Project CRUD operations (list, select, create, rename, delete).
 * - Project collaboration (join project, member roster modal, join code regeneration, member removal).
 * - Data export actions (project CSV and full Workroom JSON download).
 * - Sidebar navigation and project dropdown menus.
 */

import {
  state,
  api,
  showToast,
  getTaskDueState,
  renderDueBadgeElement,
  openModal,
  closeModal
} from "./core.js";
import { stopProjectSync, startProjectSync } from "./sync.js";
import {
  loadTasks,
  hideInlineTaskBox,
  resetFilters,
  populateAssigneeDropdowns,
  populateAssigneeFilterOptions
} from "./task.js";
import { loadCanvasPositions } from "./canvas.js";
import { loadCanvasDependencies, cancelDependencyConnection } from "./canvas-graph.js";

// Sequence counters to reject stale async responses on rapid navigation
let currentDashboardFetchSeq = 0;
let currentMembersFetchSeq = 0;

// Context menu tracking
let activeContextMenu = null;

// Extensible UI orchestration hooks (wired by main.js)
const projectHooks = {
  renderScreen: null
};

export function setProjectHooks(hooks) {
  Object.assign(projectHooks, hooks);
}

// =====================================================================
// 1. DASHBOARD DERIVATIONS & ACTIONS
// =====================================================================

/**
 * Derives the 4-item summary strip counts from raw dashboard data.
 */
export function buildDashboardSummary(projects, tasks) {
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
 */
export function getAttentionTasks(tasks) {
  const attentionList = tasks.filter(task => {
    if (task.status === "Done") return false;
    if (!task.due_date || !task.due_date.trim()) return false;
    const dueState = getTaskDueState(task);
    return dueState.type === "overdue" || dueState.type === "due-soon";
  });

  attentionList.sort((a, b) => {
    const stateA = getTaskDueState(a);
    const stateB = getTaskDueState(b);

    if (stateA.type === "overdue" && stateB.type !== "overdue") return -1;
    if (stateA.type !== "overdue" && stateB.type === "overdue") return 1;

    if (stateA.diffDays !== stateB.diffDays) {
      return stateA.diffDays - stateB.diffDays;
    }

    return a.id - b.id;
  });

  return attentionList;
}

/**
 * Derives per-project summary metrics for the Projects section on Dashboard.
 */
export function buildProjectSummaries(projects, tasks) {
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
export async function openDashboard() {
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

  if (projectHooks.renderScreen) {
    projectHooks.renderScreen();
  }

  await loadDashboard();
}

/**
 * Fetches dashboard data from /api/dashboard.
 */
export async function loadDashboard() {
  const fetchSeq = ++currentDashboardFetchSeq;

  const loadingEl = document.getElementById("dashboard-loading");
  const errorEl = document.getElementById("dashboard-error");
  const contentEl = document.getElementById("dashboard-content");
  const emptyProjectsEl = document.getElementById("dashboard-empty-projects");

  if (state.dashboard.projects.length === 0 && loadingEl && contentEl) {
    loadingEl.style.display = "block";
    if (errorEl) errorEl.style.display = "none";
    if (contentEl) contentEl.style.display = "none";
    if (emptyProjectsEl) emptyProjectsEl.style.display = "none";
  }

  const res = await api.get("/api/dashboard");

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
export function renderDashboard() {
  const errorEl = document.getElementById("dashboard-error");
  const contentEl = document.getElementById("dashboard-content");
  const emptyProjectsEl = document.getElementById("dashboard-empty-projects");

  if (errorEl) errorEl.style.display = "none";

  const projects = state.dashboard.projects || [];
  const tasks = state.dashboard.tasks || [];

  if (projects.length === 0) {
    if (emptyProjectsEl) emptyProjectsEl.style.display = "block";
    if (contentEl) contentEl.style.display = "none";
    return;
  }

  if (emptyProjectsEl) emptyProjectsEl.style.display = "none";
  if (contentEl) contentEl.style.display = "block";

  const summary = buildDashboardSummary(projects, tasks);
  renderDashboardSummary(summary);

  const attentionTasks = getAttentionTasks(tasks);
  renderAttentionTasks(attentionTasks);

  const projectSummaries = buildProjectSummaries(projects, tasks);
  renderDashboardProjects(projectSummaries);
}

export function renderDashboardSummary(summary) {
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

export function renderAttentionTasks(attentionTasks) {
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

  const maxDisplay = 8;
  const displayItems = attentionTasks.slice(0, maxDisplay);

  displayItems.forEach(task => {
    const item = document.createElement("div");
    item.className = "attention-item";
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    item.setAttribute("aria-label", `Open project for ${task.title}`);

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

    const badgeEl = renderDueBadgeElement(task, false);

    item.appendChild(content);
    if (badgeEl) item.appendChild(badgeEl);

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

  if (attentionTasks.length > maxDisplay) {
    const remaining = attentionTasks.length - maxDisplay;
    const moreNote = document.createElement("div");
    moreNote.className = "attention-more-note";
    moreNote.textContent = `+ ${remaining} more task${remaining === 1 ? "" : "s"} need attention`;
    body.appendChild(moreNote);
  }
}

export function renderDashboardProjects(projectSummaries) {
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
// 2. PROJECT CRUD ACTIONS
// =====================================================================

export async function loadProjects() {
  const res = await api.get("/api/projects");
  if (!res || !res.ok) return;

  state.projects = res.data.data || [];
  renderSidebar();
}

export async function selectProject(projectId) {
  state.screen = "project";
  state.selectedProjectId = projectId;
  sessionStorage.setItem("workroom_selected_project_id", projectId);

  resetFilters();
  hideInlineProjectForm();
  hideInlineTaskBox();

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

  renderSidebar();
  if (projectHooks.renderScreen) {
    projectHooks.renderScreen();
  }

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

export async function createProject(name) {
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

export async function renameProject(projectId, newName) {
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
      if (projectHooks.renderScreen) {
        projectHooks.renderScreen();
      }
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

export async function deleteProject(projectId) {
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
// 3. COLLABORATION & MEMBERS
// =====================================================================

export function isCurrentProjectOwner() {
  if (!state.selectedProjectId) return false;
  const p = state.projects.find(proj => proj.id === state.selectedProjectId);
  return p ? p.relationship === "owner" : false;
}

export function openJoinProjectModal() {
  const input = document.getElementById("input-join-code");
  const errEl = document.getElementById("join-project-error");
  if (input) input.value = "";
  if (errEl) {
    errEl.textContent = "";
    errEl.style.display = "none";
  }
  openModal("modal-join-project");
}

export function showJoinProjectError(msg) {
  const errEl = document.getElementById("join-project-error");
  if (errEl) {
    errEl.textContent = msg;
    errEl.style.display = "block";
  } else {
    showToast(msg, "error");
  }
}

export async function joinProject(joinCode) {
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

export async function openMembersModal(projectId) {
  const targetId = projectId || state.selectedProjectId;
  if (!targetId) return;

  closeProjectMenu();
  openModal("modal-project-members");
  await loadProjectMembers(targetId);
}

export async function loadProjectMembers(projectId) {
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

  if (inviteSection) {
    if (isOwner && data.join_code) {
      inviteSection.style.display = "block";
      if (joinCodeEl) joinCodeEl.textContent = data.join_code;
    } else {
      inviteSection.style.display = "none";
      if (joinCodeEl) joinCodeEl.textContent = "----";
    }
  }

  if (headingEl) {
    headingEl.textContent = `Members (${members.length})`;
  }

  const headerCountLabel = document.getElementById("project-members-btn-label");
  if (headerCountLabel && projectId === state.selectedProjectId) {
    headerCountLabel.textContent = `Members (${members.length})`;
  }

  if (!listEl) return;
  listEl.innerHTML = "";

  members.forEach(member => {
    const row = document.createElement("div");
    row.className = "member-row";

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

export function renderMemberList(members) {
  // Synchronized via loadProjectMembers
  const listEl = document.getElementById("project-members-list");
  if (listEl && members && members.length > 0) {
    loadProjectMembers(state.selectedProjectId);
  }
}

export async function copyJoinCode() {
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

export function openConfirmRegenerateCodeModal() {
  openModal("modal-confirm-regenerate-code");
}

export async function regenerateJoinCode() {
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

export function openConfirmRemoveMemberModal(userId, username) {
  state.pendingRemoveMember = { userId, username };
  const promptEl = document.getElementById("remove-member-prompt");
  const currentProject = state.projects.find(p => p.id === state.selectedProjectId);
  const projName = currentProject ? currentProject.name : "this project";

  if (promptEl) {
    promptEl.textContent = `Remove ${username} from “${projName}”?`;
  }
  openModal("modal-confirm-remove-member");
}

export async function removeMember() {
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

// =====================================================================
// 4. DATA EXPORTS
// =====================================================================

export async function downloadExport(url, fallbackFilename, errorMessage) {
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

export async function exportProjectCsv(projectId, projectName) {
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

export async function exportCurrentProjectCsv() {
  await exportProjectCsv(state.selectedProjectId);
}

export async function exportAllDataJson() {
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
// 5. SIDEBAR & MENUS
// =====================================================================

export function showInlineProjectForm() {
  const form = document.getElementById("inline-project-form");
  const input = document.getElementById("new-project-name");
  if (!form || !input) return;

  form.style.display = "block";
  input.value = "";
  input.focus();
}

export function hideInlineProjectForm() {
  const form = document.getElementById("inline-project-form");
  const input = document.getElementById("new-project-name");
  if (!form) return;

  form.style.display = "none";
  if (input) input.value = "";
}

export function closeGlobalContextMenu() {
  const menu = document.getElementById("global-context-menu");
  if (menu) {
    menu.style.display = "none";
    menu.innerHTML = "";
  }
  activeContextMenu = null;
}

export function openSidebarProjectMenu(e, project) {
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

  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.display = "flex";
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 180)}px`;
}

export function toggleProjectMenu() {
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

export function closeProjectMenu() {
  const menu = document.getElementById("project-menu");
  const btn = document.getElementById("project-menu-btn");
  if (menu) menu.style.display = "none";
  if (btn) btn.setAttribute("aria-expanded", "false");
}

export function openRenameProjectModal(projectId) {
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

export function openDeleteProjectModal(projectId) {
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

export function renderSidebar() {
  const navDashboardBtn = document.getElementById("nav-dashboard-btn");
  const list = document.getElementById("project-list");
  const emptyState = document.getElementById("projects-empty-state");

  if (navDashboardBtn) {
    if (state.screen === "dashboard") {
      navDashboardBtn.classList.add("active");
    } else {
      navDashboardBtn.classList.remove("active");
    }
  }

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

// =====================================================================
// 6. EVENT LISTENERS SETUP
// =====================================================================

export function setupProjectEventListeners() {
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

  // Dashboard Buttons
  const dashboardExportBtn = document.getElementById("dashboard-export-btn");
  if (dashboardExportBtn) {
    dashboardExportBtn.addEventListener("click", () => {
      exportAllDataJson();
    });
  }

  const dashboardNewProjectBtn = document.getElementById("dashboard-new-project-btn");
  if (dashboardNewProjectBtn) {
    dashboardNewProjectBtn.addEventListener("click", showInlineProjectForm);
  }

  const dashboardCreateFirstProjectBtn = document.getElementById("dashboard-create-first-project-btn");
  if (dashboardCreateFirstProjectBtn) {
    dashboardCreateFirstProjectBtn.addEventListener("click", showInlineProjectForm);
  }

  const dashboardRetryBtn = document.getElementById("dashboard-retry-btn");
  if (dashboardRetryBtn) {
    dashboardRetryBtn.addEventListener("click", () => {
      loadDashboard();
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
    const projectMenuBtnEl = document.getElementById("project-menu-btn");
    if (projectMenu && !projectMenu.contains(e.target) && e.target !== projectMenuBtnEl) {
      closeProjectMenu();
    }
    const contextMenu = document.getElementById("global-context-menu");
    if (contextMenu && !contextMenu.contains(e.target) && !e.target.closest(".project-item-menu-btn")) {
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
        if (backdrop.id !== "modal-delete-project" && backdrop.id !== "modal-delete-task") {
          closeModal(backdrop.id);
        }
      }
    });
  });
}
