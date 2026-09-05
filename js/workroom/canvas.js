/**
 * js/workroom/canvas.js - Spatial Canvas & Camera Engine
 *
 * Responsibilities:
 * - Canvas spatial layout, positions persistence and auto-grid placement.
 * - Dynamic surface expansion based on node bounds high-water mark.
 * - Camera transformation (Pan, Zoom, Clamping, Screen <-> World coordinate conversions).
 * - Canvas task node rendering and drag interactions (Pointer Events with Click vs Drag threshold).
 * - Minimap spatial overview calculation, letterboxing, viewport indicator, and navigation.
 * - Canvas viewport event bindings (Wheel pan/zoom, Double-click quick create, Space pan).
 */

import {
  state,
  api,
  showToast,
  getVisibleTasks,
  CANVAS_MIN_ZOOM,
  CANVAS_MAX_ZOOM,
  CANVAS_ZOOM_STEP,
  renderDueBadgeElement
} from "./core.js";

// Sequence counter for canvas fetch responses
let currentCanvasFetchSeq = 0;

// Minimap geometry transform snapshot
let currentMinimapTransform = null;

// Extensible graph & task hooks (avoids circular imports)
const canvasHooks = {
  renderDependencies: null,
  updateEdges: null,
  attachConnectHandle: null,
  cancelConnection: null,
  openDeleteDependencyModal: null,
  onNodeClick: null,
  showInlineTaskBox: null,
  syncCurrentProject: null,
  resetFilters: null,
  renderTasks: null
};

export function setCanvasHooks(hooks) {
  Object.assign(canvasHooks, hooks);
}

// =====================================================================
// 1. POSITIONS & SURFACE
// =====================================================================

/**
 * Fetches saved task canvas positions from the backend for the specified project.
 */
export async function loadCanvasPositions(projectId) {
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
    if (state.view === "canvas" && canvasHooks.renderTasks) {
      canvasHooks.renderTasks();
    }
  }
}

/**
 * Calculates a predictable default position for a newly created task on the canvas.
 * Places below the current lowest occupied row.
 */
export function getNextDefaultCanvasPosition() {
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
 * arranges them in a deterministic grid, and batch persists them to SQLite.
 */
export async function initializeMissingCanvasPositions(projectId) {
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
 * Dynamically expands the canvas surface when nodes approach edges.
 */
export function updateCanvasSurfaceDimensions(maxX, maxY) {
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

// =====================================================================
// 2. CAMERA & GEOMETRY
// =====================================================================

/**
 * Applies the camera transformation (panX, panY, zoom) to the canvas transform layer.
 * Also keeps the background dot grid in sync and updates the zoom percentage label.
 */
export function applyCanvasTransform() {
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
 * Converts screen client coordinates (clientX, clientY) to Canvas world coordinates.
 */
export function screenToCanvasWorld(clientX, clientY) {
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
 * Converts Canvas world coordinates (worldX, worldY) to screen client coordinates.
 */
export function canvasWorldToScreen(worldX, worldY) {
  const viewport = document.getElementById("canvas-viewport");
  const rect = viewport ? viewport.getBoundingClientRect() : { left: 0, top: 0 };
  const { panX, panY, zoom } = state.canvas.camera;
  return {
    x: rect.left + panX + worldX * zoom,
    y: rect.top + panY + worldY * zoom
  };
}

/**
 * Centralized camera pan clamping to prevent accidental infinite pan drift.
 */
export function clampCanvasCamera() {
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
 * Zooms the canvas anchored around an exact screen coordinate.
 */
export function zoomCanvasAtPoint(targetZoom, clientX, clientY) {
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
 * Zooms the canvas centered in the viewport (for +/- buttons).
 */
export function zoomCanvasCenter(deltaZoom) {
  const viewport = document.getElementById("canvas-viewport");
  if (!viewport) return;
  const rect = viewport.getBoundingClientRect();
  zoomCanvasAtPoint(state.canvas.camera.zoom + deltaZoom, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

/**
 * Calculates bounding box of currently visible tasks and adjusts camera to fit them comfortably.
 */
export function fitCanvasTasks() {
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
 * Centralized helper for retrieving world-space bounds of a task node.
 */
export function getCanvasNodeBounds(taskId) {
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
 * Checks if an event target corresponds to the blank canvas background.
 */
export function isBlankCanvasTarget(target) {
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

// =====================================================================
// 3. CANVAS VIEW RENDERING & NODE DRAGGING
// =====================================================================

/**
 * Renders visible tasks as draggable absolute-positioned nodes on the canvas surface.
 */
export function renderCanvasView(visibleTasks) {
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
    if (canvasHooks.renderDependencies) {
      canvasHooks.renderDependencies();
    }
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

    // 4. Connect handle (right side for A -> B drag)
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "canvas-node-handle";
    handle.setAttribute("aria-label", `Create dependency from ${task.title}`);
    handle.title = "Drag to connect dependency";
    handle.dataset.taskId = String(task.id);
    if (canvasHooks.attachConnectHandle) {
      canvasHooks.attachConnectHandle(handle, task.id);
    }
    node.appendChild(handle);

    // Keyboard accessibility: Enter or Space opens task details dialog
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (canvasHooks.onNodeClick) {
          canvasHooks.onNodeClick(task.id);
        }
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
  if (canvasHooks.renderDependencies) {
    canvasHooks.renderDependencies();
  }
  renderCanvasMinimap(visibleTasks);
}

/**
 * Attaches Pointer Events to a canvas node for dragging with zoom compensation.
 */
export function setupCanvasNodePointer(nodeEl, taskId) {
  nodeEl.addEventListener("pointerdown", (e) => {
    // If middle mouse or Space is held, let event bubble to canvas viewport for panning
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
        if (canvasHooks.updateEdges) {
          canvasHooks.updateEdges(taskId, newX, newY);
        }
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
        if (canvasHooks.onNodeClick) {
          canvasHooks.onNodeClick(taskId);
        }
        return;
      }

      // Drag ended: compute final clamped world coordinates
      const zoom = state.canvas.camera.zoom || 1.0;
      const finalX = Math.max(0, Math.round(originX + (upEvent.clientX - startPointerX) / zoom));
      const finalY = Math.max(0, Math.round(originY + (upEvent.clientY - startPointerY) / zoom));

      state.canvas.positions[taskId] = { x: finalX, y: finalY };
      if (canvasHooks.updateEdges) {
        canvasHooks.updateEdges(taskId, finalX, finalY);
      }
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
          if (canvasHooks.updateEdges) {
            canvasHooks.updateEdges(taskId, originX, originY);
          }
          renderCanvasMinimap(getVisibleTasks());
          showToast("Could not save task position.", "error");
        }
      } catch (err) {
        // Rollback on network failure
        nodeEl.style.left = `${originX}px`;
        nodeEl.style.top = `${originY}px`;
        state.canvas.positions[taskId] = { x: originX, y: originY };
        if (canvasHooks.updateEdges) {
          canvasHooks.updateEdges(taskId, originX, originY);
        }
        renderCanvasMinimap(getVisibleTasks());
        showToast("Could not save task position.", "error");
      } finally {
        state.sync.isDragging = false;
        // Run any revision sync deferred during the drag
        if (state.sync.deferred && state.sync.pendingRevision != null) {
          const pendingRev = state.sync.pendingRevision;
          state.sync.deferred = false;
          state.sync.pendingRevision = null;
          if (canvasHooks.syncCurrentProject) {
            await canvasHooks.syncCurrentProject(pendingRev);
          }
        }
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  });
}

// =====================================================================
// 4. PAN, ZOOM, AND DOUBLE-CLICK QUICK CREATE
// =====================================================================

/**
 * Initiates canvas panning on primary drag (blank space), Space + drag, or middle mouse drag.
 */
export function startCanvasPan(startEvent) {
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
      if (canvasHooks.syncCurrentProject) {
        canvasHooks.syncCurrentProject(pendingRev);
      }
    }
  }

  window.addEventListener("pointermove", onPanMove);
  window.addEventListener("pointerup", onPanEnd);
  window.addEventListener("pointercancel", onPanEnd);
}

/**
 * Handles mouse wheel events for canvas panning and Ctrl/Cmd pointer-anchored zoom.
 */
export function onCanvasWheel(e) {
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
 * Handles double-click on blank canvas to trigger Quick Create.
 */
export function onCanvasDoubleClick(e) {
  if (state.canvas.justPanned || state.canvas.justConnected) return;
  if (!isBlankCanvasTarget(e.target)) return;

  const worldPos = screenToCanvasWorld(e.clientX, e.clientY);
  state.canvas.pendingCreatePosition = {
    x: Math.max(0, worldPos.x),
    y: Math.max(0, worldPos.y)
  };

  if (canvasHooks.showInlineTaskBox) {
    canvasHooks.showInlineTaskBox();
  }
}

/**
 * Initializes pan, zoom, and quick-create event bindings on the canvas viewport and controls.
 */
export function initCanvasPanZoom() {
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
        if (canvasHooks.renderDependencies) {
          canvasHooks.renderDependencies();
        }
      }
      e.preventDefault();
      startCanvasPan(e);
    }
  });

  // Wheel handling for pan & pointer-anchored zoom
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

  // Canvas empty overlay buttons
  const emptyAddBtn = document.getElementById("canvas-empty-add-btn");
  if (emptyAddBtn) {
    emptyAddBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.canvas.pendingCreatePosition = null;
      if (canvasHooks.showInlineTaskBox) {
        canvasHooks.showInlineTaskBox();
      }
    });
  }

  const emptyClearBtn = document.getElementById("canvas-empty-clear-btn");
  if (emptyClearBtn) {
    emptyClearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (canvasHooks.resetFilters) {
        canvasHooks.resetFilters();
      }
      if (canvasHooks.renderTasks) {
        canvasHooks.renderTasks();
      }
    });
  }

  // Initialize Canvas Minimap interactions
  initCanvasMinimap();
}

/**
 * Keyboard shortcuts for Space pan, keyboard zoom (+, -), and fit (0).
 */
export function setupCanvasKeyboard() {
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
        if (canvasHooks.openDeleteDependencyModal) {
          canvasHooks.openDeleteDependencyModal(
            state.canvas.selectedDependency.from_task_id,
            state.canvas.selectedDependency.to_task_id
          );
        }
      }
    } else if (e.key === "Escape") {
      if (state.canvas.isConnecting) {
        e.preventDefault();
        if (canvasHooks.cancelConnection) {
          canvasHooks.cancelConnection();
        }
      } else if (state.canvas.selectedDependency && !state.activeModal) {
        e.preventDefault();
        state.canvas.selectedDependency = null;
        if (canvasHooks.renderDependencies) {
          canvasHooks.renderDependencies();
        }
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
    if (canvasHooks.cancelConnection) {
      canvasHooks.cancelConnection();
    }
    const viewport = document.getElementById("canvas-viewport");
    if (viewport) {
      viewport.classList.remove("space-held");
      viewport.classList.remove("panning");
    }
  });
}

// =====================================================================
// 5. CANVAS MINIMAP
// =====================================================================

/**
 * Computes centralized geometry transform for Canvas Minimap.
 */
export function getMinimapTransform(visibleTasks) {
  const viewport = document.getElementById("canvas-viewport");
  const minimapEl = document.getElementById("canvas-minimap");
  if (!viewport || !minimapEl) return null;

  const vWidth = viewport.clientWidth || 1200;
  const vHeight = viewport.clientHeight || 800;
  const miniWidth = minimapEl.clientWidth || 180;
  const miniHeight = minimapEl.clientHeight || 120;
  const { panX, panY, zoom } = state.canvas.camera;

  const worldLeft = -panX / zoom;
  const worldTop = -panY / zoom;
  const worldWidth = vWidth / zoom;
  const worldHeight = vHeight / zoom;
  const worldRight = worldLeft + worldWidth;
  const worldBottom = worldTop + worldHeight;

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

  const PADDING = 120;
  minX -= PADDING;
  minY -= PADDING;
  maxX += PADDING;
  maxY += PADDING;

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
 * Converts world coordinates to Minimap coordinates.
 */
export function worldToMinimap(worldX, worldY, transform) {
  const t = transform || currentMinimapTransform;
  if (!t) return { x: 0, y: 0 };
  return {
    x: (worldX - t.worldMinX) * t.scale + t.offsetX,
    y: (worldY - t.worldMinY) * t.scale + t.offsetY
  };
}

/**
 * Converts Minimap coordinates to world coordinates.
 */
export function minimapToWorld(miniX, miniY, transform) {
  const t = transform || currentMinimapTransform;
  if (!t) return { x: 0, y: 0 };
  return {
    x: (miniX - t.offsetX) / t.scale + t.worldMinX,
    y: (miniY - t.offsetY) / t.scale + t.worldMinY
  };
}

/**
 * Centers the main Canvas camera on the specified world coordinate while preserving zoom.
 */
export function centerCanvasOnWorldPoint(targetWorldX, targetWorldY) {
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
 * Renders the visible task markers in the Minimap SVG.
 */
export function renderCanvasMinimap(visibleTasks) {
  const minimapEl = document.getElementById("canvas-minimap");
  const tasksGroup = document.getElementById("minimap-tasks-group");
  if (!minimapEl || !tasksGroup) return;

  // Hide minimap if not in project canvas view or if 0 visible tasks
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
 * Updates the minimap viewport indicator rectangle live without re-rendering task nodes.
 */
export function updateMinimapViewport() {
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

  // If camera viewport expanded outside existing minimap bounds, recompute bounds
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
 * Updates a single task node's position in the Minimap during canvas node dragging.
 */
export function updateMinimapTaskPosition(taskId, newWorldX, newWorldY) {
  if (!currentMinimapTransform) return;
  const rect = document.getElementById(`minimap-task-${taskId}`);
  if (!rect) return;

  const miniPos = worldToMinimap(newWorldX, newWorldY, currentMinimapTransform);
  rect.setAttribute("x", Math.round(miniPos.x * 10) / 10);
  rect.setAttribute("y", Math.round(miniPos.y * 10) / 10);
}

/**
 * Initializes Minimap pointer events (click-to-navigate and viewport drag).
 */
export function initCanvasMinimap() {
  const minimapEl = document.getElementById("canvas-minimap");
  const svgEl = document.getElementById("canvas-minimap-svg");
  const viewportRect = document.getElementById("minimap-viewport-rect");
  if (!minimapEl || !svgEl || !viewportRect) return;

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

  viewportRect.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (state.canvas.isConnecting) return;

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

  // Click on minimap overview to center canvas
  svgEl.addEventListener("pointerdown", (e) => {
    if (e.target === viewportRect) return;
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

/**
 * Sets up all canvas event listeners once.
 */
export function setupCanvasEventListeners() {
  initCanvasPanZoom();
  setupCanvasKeyboard();

  window.addEventListener("resize", () => {
    if (state.screen === "project" && state.view === "canvas") {
      updateMinimapViewport();
    }
  });
}
