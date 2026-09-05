/**
 * js/workroom/task.js - Task Domain Actions, Kanban, List, and Comments
 *
 * Responsibilities:
 * - Task CRUD operations (list, create, update/patch, delete).
 * - Fast Task creation UI (inline toolbar box) with canvas position placement.
 * - Task edit/details modal with dirty detection and assignee selector.
 * - Native HTML5 drag-and-drop for Kanban status progression.
 * - List view table rendering and status updates.
 * - Task comments (fetch, render, post, delete confirmation).
 * - Search & Filter toolbar UI bindings and active filter state synchronization.
 */

import {
  state,
  STATUSES,
  api,
  showToast,
  getVisibleTasks,
  renderDueBadgeElement,
  openModal,
  closeModal
} from "./core.js";
import { getNextDefaultCanvasPosition, renderCanvasView, setCanvasHooks } from "./canvas.js";
import { cancelDependencyConnection } from "./canvas-graph.js";

// Sequence counters to reject stale async responses on rapid navigation
let currentTaskFetchSeq = 0;
let currentCommentsFetchSeq = 0;
let draggedTaskId = null;

// Extensible orchestration hooks
const taskHooks = {
  onAccessLost: null,
  syncCurrentProject: null
};

export function setTaskHooks(hooks) {
  Object.assign(taskHooks, hooks);
}

// =====================================================================
// 1. TASK CRUD ACTIONS
// =====================================================================

/**
 * Loads tasks for the active project.
 */
export async function loadTasks(projectId) {
  const fetchSeq = ++currentTaskFetchSeq;

  const res = await api.get(`/api/projects/${projectId}/tasks`);

  // Discard stale response if user switched screen or project while fetch was in flight
  if (fetchSeq !== currentTaskFetchSeq || state.screen !== "project" || state.selectedProjectId !== projectId) {
    return;
  }

  if (!res || !res.ok) {
    if (res && res.status === 403) {
      if (taskHooks.onAccessLost) {
        await taskHooks.onAccessLost("forbidden");
      }
      return;
    }
    if (res && res.status === 404) {
      if (taskHooks.onAccessLost) {
        await taskHooks.onAccessLost("deleted");
      }
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
export async function createTask(title, description = "", dueDate = null, assigneeId = null) {
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
        if (taskHooks.onAccessLost) {
          await taskHooks.onAccessLost("forbidden");
        }
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
 * Updates task title, description, status, due_date, and/or assignee_id.
 */
export async function updateTask(taskId, updates) {
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
        if (taskHooks.onAccessLost) {
          await taskHooks.onAccessLost("forbidden");
        }
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
export async function updateTaskStatus(taskId, newStatus) {
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
      if (taskHooks.onAccessLost) {
        await taskHooks.onAccessLost("forbidden");
      }
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
export async function deleteTask(taskId) {
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
        if (taskHooks.onAccessLost) {
          await taskHooks.onAccessLost("forbidden");
        }
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
// 2. MODAL & INLINE FORMS
// =====================================================================

export function showInlineTaskBox() {
  const box = document.getElementById("inline-task-box");
  const titleInput = document.getElementById("fast-task-title");
  if (!box || !titleInput) return;

  box.style.display = "block";
  titleInput.focus();
}

export function hideInlineTaskBox() {
  const box = document.getElementById("inline-task-box");
  const titleInput = document.getElementById("fast-task-title");
  const descInput = document.getElementById("fast-task-description");
  const dueInput = document.getElementById("fast-task-due-date");
  const assigneeInput = document.getElementById("fast-task-assignee");

  state.canvas.pendingCreatePosition = null;

  if (!box) return;

  box.style.display = "none";
  if (titleInput) titleInput.value = "";
  if (descInput) descInput.value = "";
  if (dueInput) dueInput.value = "";
  if (assigneeInput) assigneeInput.value = "";
}

export function openEditTaskModal(taskId) {
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

  const notice = document.getElementById("task-edit-remote-notice");
  if (notice) notice.style.display = "none";

  const commentInput = document.getElementById("task-comment-input");
  if (commentInput) commentInput.value = "";

  openModal("modal-edit-task");
  loadTaskComments(taskId);
}

export function openDeleteTaskModal(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  state.pendingDeleteTaskId = taskId;
  const prompt = document.getElementById("delete-task-prompt");
  if (prompt) prompt.textContent = `Delete “${task.title}”?`;
  openModal("modal-delete-task");
}

export function populateAssigneeDropdowns() {
  const fastSelect = document.getElementById("fast-task-assignee");
  const editSelect = document.getElementById("select-edit-task-assignee");
  const currentProj = state.projects.find(p => p.id === state.selectedProjectId);

  const participantMap = new Map();
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

  function populateSelect(selectEl) {
    if (!selectEl) return;
    const currentVal = selectEl.value;
    selectEl.innerHTML = "";

    const optUnassigned = document.createElement("option");
    optUnassigned.value = "";
    optUnassigned.textContent = "Unassigned";
    selectEl.appendChild(optUnassigned);

    participantMap.forEach(participant => {
      const opt = document.createElement("option");
      opt.value = String(participant.id);
      opt.textContent = participant.username;
      selectEl.appendChild(opt);
    });

    if (currentVal && participantMap.has(parseInt(currentVal, 10))) {
      selectEl.value = currentVal;
    } else {
      selectEl.value = "";
    }
  }

  populateSelect(fastSelect);
  populateSelect(editSelect);
}

// =====================================================================
// 3. TASK COMMENTS
// =====================================================================

export async function loadTaskComments(taskId) {
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

export function renderCommentsList(comments) {
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

export async function postTaskComment() {
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

export function openDeleteCommentModal(commentId) {
  state.pendingDeleteCommentId = commentId;
  openModal("modal-confirm-delete-comment");
}

export async function confirmDeleteComment() {
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

// =====================================================================
// 4. KANBAN & LIST RENDERING & DRAG-AND-DROP
// =====================================================================

export function setupDragAndDrop() {
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

export function handleCardDragStart(e, taskId) {
  state.sync.isDragging = true;
  draggedTaskId = taskId;
  e.dataTransfer.setData("text/plain", taskId.toString());
  e.dataTransfer.effectAllowed = "move";
  e.currentTarget.classList.add("dragging");
}

export function handleCardDragEnd(e) {
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
    if (pendingRev !== null && pendingRev !== undefined && taskHooks.syncCurrentProject) {
      taskHooks.syncCurrentProject(pendingRev);
    }
  }
}

export function renderTasks() {
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

export function renderListView(visibleTasks) {
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

export function renderKanbanView(visibleTasks) {
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

      card.addEventListener("dragstart", (e) => handleCardDragStart(e, task.id));
      card.addEventListener("dragend", handleCardDragEnd);

      listEl.appendChild(card);
    });
  });
}

// =====================================================================
// 5. SEARCH & FILTER TOOLBAR CONTROLS
// =====================================================================

export function populateAssigneeFilterOptions() {
  const selectEl = document.getElementById("filter-assignee");
  if (!selectEl) return;

  const currentProj = state.projects.find(p => p.id === state.selectedProjectId);
  const participantMap = new Map();

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

  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "All assignees";
  selectEl.appendChild(optAll);

  const optMe = document.createElement("option");
  optMe.value = "me";
  optMe.textContent = "My tasks";
  selectEl.appendChild(optMe);

  const optUnassigned = document.createElement("option");
  optUnassigned.value = "unassigned";
  optUnassigned.textContent = "Unassigned";
  selectEl.appendChild(optUnassigned);

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

export function updateFilterControlsUI() {
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

export function resetFilters() {
  state.searchQuery = "";
  state.statusFilter = "all";
  state.dueFilter = "all";
  state.assigneeFilter = "all";
  cancelDependencyConnection();
  updateFilterControlsUI();
}

// =====================================================================
// 6. EVENT LISTENERS SETUP
// =====================================================================

export function setupTaskEventListeners() {
  // Register hooks with canvas.js
  setCanvasHooks({
    onNodeClick: (taskId) => openEditTaskModal(taskId),
    showInlineTaskBox: showInlineTaskBox,
    resetFilters: resetFilters,
    renderTasks: renderTasks
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

  // Fast task title keyboard handling
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

  // Fast task due date keyboard handling
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

  // Fast task description keyboard handling (Ctrl/Cmd+Enter submits)
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

  // Filter Selects
  const statusFilterSelect = document.getElementById("filter-status");
  if (statusFilterSelect) {
    statusFilterSelect.addEventListener("change", (e) => {
      state.statusFilter = e.target.value;
      cancelDependencyConnection();
      renderTasks();
    });
  }

  const dueFilterSelect = document.getElementById("filter-due");
  if (dueFilterSelect) {
    dueFilterSelect.addEventListener("change", (e) => {
      state.dueFilter = e.target.value;
      cancelDependencyConnection();
      renderTasks();
    });
  }

  const assigneeFilterSelect = document.getElementById("filter-assignee");
  if (assigneeFilterSelect) {
    assigneeFilterSelect.addEventListener("change", (e) => {
      state.assigneeFilter = e.target.value;
      cancelDependencyConnection();
      renderTasks();
    });
  }

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

  // Edit Task Modal Form
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
          closeModal("modal-edit-task");
          return;
        }

        updateTask(state.editingTaskId, updates);
      }
    });
  }

  // Confirm Delete Task Action
  const btnConfirmDeleteTask = document.getElementById("btn-confirm-delete-task");
  if (btnConfirmDeleteTask) {
    btnConfirmDeleteTask.addEventListener("click", () => {
      if (state.pendingDeleteTaskId) {
        deleteTask(state.pendingDeleteTaskId);
      }
    });
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
}
