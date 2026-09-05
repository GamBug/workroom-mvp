/**
 * js/workroom/canvas-graph.js - Task Dependency Graph & SVG Edge Layer
 *
 * Responsibilities:
 * - Load, create, and delete directed task dependencies via REST API.
 * - Render smooth cubic Bézier SVG edges between predecessor and dependent task nodes.
 * - Dynamic edge recalculation during task node dragging (zero network calls).
 * - Interactive connection dragging via node handles with live rubberband preview.
 * - Contextual edge selection and confirmation modal for dependency deletion.
 */

import { state, api, showToast, getVisibleTasks, openModal, closeModal } from "./core.js";
import { getCanvasNodeBounds, screenToCanvasWorld, setCanvasHooks } from "./canvas.js";

/**
 * Fetches saved task dependencies from the backend for the specified project.
 */
export async function loadCanvasDependencies(projectId) {
  if (!projectId || state.screen !== "project" || state.selectedProjectId !== projectId) return;

  try {
    const res = await api.request(`/api/projects/${projectId}/dependencies`, {
      method: "GET",
      silent: true
    });

    if (state.screen !== "project" || state.selectedProjectId !== projectId) {
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
 */
export async function createTaskDependency(fromTaskId, toTaskId) {
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
 */
export async function deleteTaskDependency(fromTaskId, toTaskId) {
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
 * Generates smooth cubic Bézier SVG path data between two world points.
 */
export function buildDependencyPath(startPoint, endPoint) {
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
 * Renders all valid dependency edges in the SVG layer.
 * Only renders edges if BOTH endpoint tasks are currently visible.
 */
export function renderCanvasDependencies() {
  if (state.view !== "canvas") return;
  const edgeGroup = document.getElementById("canvas-edge-group");
  const deleteBtn = document.getElementById("canvas-edge-delete-btn");
  if (!edgeGroup) return;

  edgeGroup.innerHTML = "";

  const visibleTasks = getVisibleTasks();
  const visibleTaskIds = new Set(visibleTasks.map(t => t.id));

  let selectedEdgeFound = false;

  state.canvas.dependencies.forEach(dep => {
    // Both endpoints must be visible
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

    // Transparent wider hit path for easy clicking
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
 * Real-time live update for dependency edges connected to a dragged task node.
 */
export function updateConnectedCanvasEdges(taskId, currentX, currentY) {
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
export function selectCanvasEdge(fromTaskId, toTaskId, midX, midY) {
  state.canvas.selectedDependency = { from_task_id: fromTaskId, to_task_id: toTaskId };
  renderCanvasDependencies();
}

/**
 * Opens confirmation modal for removing a dependency.
 */
export function openDeleteDependencyModal(fromTaskId, toTaskId) {
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
 * Attaches pointerdown to connect handle to initiate dependency drag.
 */
export function setupCanvasNodeConnectHandle(handleEl, sourceTaskId) {
  handleEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    startDependencyConnection(e, sourceTaskId);
  });
}

/**
 * Initiates drag-to-connect dependency gesture with live preview.
 */
export function startDependencyConnection(startEvent, sourceTaskId) {
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
  }

  window.addEventListener("pointermove", onConnectMove);
  window.addEventListener("pointerup", onConnectEnd);
  window.addEventListener("pointercancel", onConnectEnd);
}

export function cancelDependencyConnectionVisuals() {
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

export function cancelDependencyConnection() {
  state.canvas.isConnecting = false;
  state.canvas.connectSourceTaskId = null;
  cancelDependencyConnectionVisuals();
}

/**
 * Initializes listeners for graph edge interactions and registers hooks with canvas.js.
 */
export function setupCanvasGraphEventListeners() {
  // Register hooks with canvas.js so canvas can trigger dependency rendering without circular imports
  setCanvasHooks({
    renderDependencies: renderCanvasDependencies,
    updateEdges: updateConnectedCanvasEdges,
    attachConnectHandle: setupCanvasNodeConnectHandle,
    cancelConnection: cancelDependencyConnection,
    openDeleteDependencyModal: openDeleteDependencyModal
  });

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
}
