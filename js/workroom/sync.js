/**
 * js/workroom/sync.js - Lightweight Multi-User Synchronization
 *
 * Responsibilities:
 * - Single active HTTP periodic polling loop for project revisions.
 * - Stale request guards across project switches and screen navigation.
 * - Deferred synchronization during active drag/pan gestures to protect UX.
 * - Conflict detection and dirty form protection for task edits.
 * - Draft preservation for comment composers during background refresh.
 * - Access-loss handling when a member is removed or project is deleted.
 * - Visibility change detection (pausing polling when tab is hidden).
 */

import { state, api, showToast, closeModal, SYNC_POLL_INTERVAL } from "./core.js";

// Extensible orchestration hooks (wired by main.js without circular imports)
const syncHooks = {
  onSyncUpdate: null,
  onAccessLost: null,
  renderSidebar: null,
  renderScreen: null
};

export function setSyncHooks(hooks) {
  Object.assign(syncHooks, hooks);
}

/**
 * Halts any active project polling timer and resets synchronization flags.
 */
export function stopProjectSync() {
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
export function startProjectSync(projectId, initialRevision = null) {
  stopProjectSync();
  state.sync.projectId = projectId;
  state.sync.lastRevision = initialRevision;
  state.sync.pollSeq++;
  scheduleNextPoll();
}

/**
 * Schedules the next poll execution using setTimeout to avoid overlapping requests.
 */
export function scheduleNextPoll(delay = SYNC_POLL_INTERVAL) {
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
export async function pollProjectRevision() {
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
        if (syncHooks.renderSidebar) syncHooks.renderSidebar();
        if (syncHooks.renderScreen) syncHooks.renderScreen();
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
export async function syncCurrentProject(newRevision) {
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

    if (syncHooks.onSyncUpdate) {
      await syncHooks.onSyncUpdate(newTasks, projectId);
    }

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
export async function handleProjectAccessLost(reason) {
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

  if (syncHooks.onAccessLost) {
    await syncHooks.onAccessLost();
  }
}

/**
 * Checks whether user has modified any field in the open Edit Task modal.
 */
export function isTaskEditModalDirty() {
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
export function updateTaskEditModalValues(remoteTask) {
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

export function showTaskEditRemoteNotice() {
  const notice = document.getElementById("task-edit-remote-notice");
  if (notice) notice.style.display = "block";
}

export function hideTaskEditRemoteNotice() {
  const notice = document.getElementById("task-edit-remote-notice");
  if (notice) notice.style.display = "none";
}

/**
 * Re-fetches task comments while strictly preserving any typed comment in the composer.
 */
export async function refreshTaskCommentsPreservingDraft(taskId) {
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

  const listEl = document.getElementById("task-comments-list");
  if (listEl) {
    listEl.innerHTML = "";
    if (comments.length === 0) {
      const emptyHint = document.createElement("p");
      emptyHint.className = "comments-empty-hint";
      emptyHint.textContent = "No comments yet. Leave a note below.";
      listEl.appendChild(emptyHint);
    } else {
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

        const content = document.createElement("div");
        content.className = "comment-content";
        content.textContent = c.content;

        item.appendChild(header);
        item.appendChild(content);
        listEl.appendChild(item);
      });
      listEl.scrollTop = listEl.scrollHeight;
    }
  }

  if (commentInput) {
    commentInput.value = draft;
  }
}

/**
 * Attaches visibility change listener to handle background tab sync suspension.
 */
export function setupSyncEventListeners() {
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
}
