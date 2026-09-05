/**
 * js/workroom/main.js - Application Bootstrap & Module Orchestration
 *
 * Responsibilities:
 * - Application initialization on DOMContentLoaded.
 * - Verify session authentication against /api/me.
 * - High-level screen & view switching orchestration (Kanban, List, Canvas).
 * - Cross-module lifecycle wiring (Sync, Project, Task, Canvas, Canvas Graph).
 * - Global application shortcuts and teardown handling.
 */

import { state, api, closeModal } from "./core.js";
import { setSyncHooks, stopProjectSync, syncCurrentProject, handleProjectAccessLost, setupSyncEventListeners } from "./sync.js";
import {
  openDashboard,
  loadProjects,
  renderSidebar,
  closeProjectMenu,
  closeGlobalContextMenu,
  setProjectHooks,
  setupProjectEventListeners
} from "./project.js";
import {
  renderTasks,
  setupDragAndDrop,
  setTaskHooks,
  setupTaskEventListeners,
  populateAssigneeDropdowns,
  populateAssigneeFilterOptions
} from "./task.js";
import {
  loadCanvasPositions,
  applyCanvasTransform,
  setupCanvasEventListeners
} from "./canvas.js";
import {
  loadCanvasDependencies,
  cancelDependencyConnection,
  setupCanvasGraphEventListeners
} from "./canvas-graph.js";

// =====================================================================
// 1. SCREEN & VIEW SWITCHING ORCHESTRATION
// =====================================================================

/**
 * Updates high-level screen visibility (Dashboard vs Project Workspace).
 */
export function renderScreen() {
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

    // Ensure active view tab (Kanban, List, or Canvas) is applied
    switchView(state.view);
  }
}

/**
 * Switches project view between Kanban, List, and Canvas modes.
 */
export async function switchView(viewName) {
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
// 2. ORCHESTRATION WIRING
// =====================================================================

function wireModuleOrchestration() {
  // Wire Sync callbacks without circular dependencies
  setSyncHooks({
    onSyncUpdate: async () => {
      populateAssigneeDropdowns();
      populateAssigneeFilterOptions();
      renderTasks();
    },
    onAccessLost: async () => {
      await openDashboard();
      await loadProjects();
    },
    renderSidebar: renderSidebar,
    renderScreen: renderScreen
  });

  // Wire Task callbacks
  setTaskHooks({
    onAccessLost: async (reason) => {
      await handleProjectAccessLost(reason);
    },
    syncCurrentProject: syncCurrentProject
  });

  // Wire Project callbacks
  setProjectHooks({
    renderScreen: renderScreen
  });
}

// =====================================================================
// 3. GLOBAL APPLICATION LISTENERS
// =====================================================================

function setupGlobalEventListeners() {
  // Logout
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      stopProjectSync();
      await api.post("/api/logout", {});
      window.location.href = "/";
    });
  }

  // View Switcher Buttons
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

  // Global Escape key to dismiss modals or menus
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (state.activeModal) {
        closeModal(state.activeModal);
      }
      closeProjectMenu();
      closeGlobalContextMenu();
    }
  });
}

// =====================================================================
// 4. APPLICATION BOOTSTRAP
// =====================================================================

export async function initApp() {
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

  // 2. Wire inter-module orchestration hooks
  wireModuleOrchestration();

  // 3. Setup domain event listeners (registered once)
  setupGlobalEventListeners();
  setupProjectEventListeners();
  setupTaskEventListeners();
  setupCanvasEventListeners();
  setupCanvasGraphEventListeners();
  setupSyncEventListeners();
  setupDragAndDrop();

  // 4. Open Dashboard as default landing screen on fresh load / login
  await openDashboard();
}

// Start application when DOM is ready
document.addEventListener("DOMContentLoaded", initApp);
