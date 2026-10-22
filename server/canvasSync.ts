import { db } from './db.js';

export const TASK_WIDTH = 260;
export const TASK_HEIGHT = 110;
export const TASK_CENTER_OFFSET_X = 130;
export const TASK_CENTER_OFFSET_Y = 55;

export interface EpicRow {
  id: string;
  project_id: string;
  title: string;
  color: string;
  canvas_x: number;
  canvas_y: number;
  canvas_width: number;
  canvas_height: number;
}

export interface TaskRow {
  id: string;
  project_id: string;
  epic_id: string | null;
  title: string;
  canvas_x: number;
  canvas_y: number;
}

/**
 * Checks if a task's center (taskX + 130, taskY + 55) is inside an Epic's bounding box
 */
export function isTaskCenterInsideEpic(
  taskX: number,
  taskY: number,
  epic: EpicRow
): boolean {
  const cx = taskX + TASK_CENTER_OFFSET_X;
  const cy = taskY + TASK_CENTER_OFFSET_Y;
  return (
    cx >= epic.canvas_x &&
    cx <= epic.canvas_x + epic.canvas_width &&
    cy >= epic.canvas_y &&
    cy <= epic.canvas_y + epic.canvas_height
  );
}

/**
 * Computes a non-overlapping coordinate for a new Epic (60px to the right of existing Epics)
 */
export function computeNewEpicPosition(projectId: string): {
  canvasX: number;
  canvasY: number;
} {
  const epics = db
    .prepare('SELECT canvas_x, canvas_width FROM epics WHERE project_id = ?')
    .all(projectId) as Array<{ canvas_x: number; canvas_width: number }>;

  if (epics.length === 0) {
    return { canvasX: 80, canvasY: 80 };
  }

  const maxRightEdge = Math.max(
    ...epics.map((e) => (e.canvas_x || 80) + (e.canvas_width || 520))
  );

  return {
    canvasX: maxRightEdge + 60,
    canvasY: 80,
  };
}

/**
 * Computes coordinate for a task inside an Epic frame, auto-expanding Epic height if full
 */
export function computeTaskPositionInEpic(
  projectId: string,
  epicId: string
): { canvasX: number; canvasY: number } {
  const epic = db
    .prepare('SELECT * FROM epics WHERE id = ?')
    .get(epicId) as EpicRow | undefined;

  if (!epic) {
    return { canvasX: 120, canvasY: 140 };
  }

  const existingTasks = db
    .prepare('SELECT id FROM tasks WHERE epic_id = ?')
    .all(epicId) as Array<{ id: string }>;

  const index = existingTasks.length;
  const cols = 2;
  const taskColWidth = 280;
  const taskRowHeight = 135;
  const paddingX = 28;
  const headerOffsetY = 65;

  const col = index % cols;
  const row = Math.floor(index / cols);

  const taskX = epic.canvas_x + paddingX + col * taskColWidth;
  const taskY = epic.canvas_y + headerOffsetY + row * taskRowHeight;

  // Check if we need to auto-expand the Epic container height
  const requiredHeight = headerOffsetY + (row + 1) * taskRowHeight + 35;
  if (requiredHeight > epic.canvas_height) {
    db.prepare('UPDATE epics SET canvas_height = ? WHERE id = ?').run(
      Math.max(requiredHeight, 360),
      epicId
    );
  }

  return { canvasX: taskX, canvasY: taskY };
}

/**
 * Computes coordinate for an independent task outside any Epic frames
 */
export function computeIndependentTaskPosition(projectId: string): {
  canvasX: number;
  canvasY: number;
} {
  const epics = db
    .prepare('SELECT canvas_x, canvas_width FROM epics WHERE project_id = ?')
    .all(projectId) as Array<{ canvas_x: number; canvas_width: number }>;

  const unassignedTasks = db
    .prepare('SELECT id FROM tasks WHERE project_id = ? AND epic_id IS NULL')
    .all(projectId) as Array<{ id: string }>;

  let startX = 80;
  if (epics.length > 0) {
    const maxEpicRight = Math.max(
      ...epics.map((e) => (e.canvas_x || 80) + (e.canvas_width || 520))
    );
    startX = maxEpicRight + 60;
  }

  const index = unassignedTasks.length;
  const cols = 2;
  const taskColWidth = 280;
  const taskRowHeight = 135;

  const col = index % cols;
  const row = Math.floor(index / cols);

  return {
    canvasX: startX + col * taskColWidth,
    canvasY: 80 + 40 + row * taskRowHeight,
  };
}

/**
 * Automatically adjusts canvas coordinate if changing epicId places task outside/inside inappropriately
 */
export function adjustTaskPositionOnEpicChange(
  currentTask: TaskRow,
  newEpicId: string | null,
  projectId: string
): { canvasX: number; canvasY: number } {
  // If moving into an Epic
  if (newEpicId !== null) {
    const targetEpic = db
      .prepare('SELECT * FROM epics WHERE id = ?')
      .get(newEpicId) as EpicRow | undefined;

    if (targetEpic) {
      const isInside = isTaskCenterInsideEpic(
        currentTask.canvas_x,
        currentTask.canvas_y,
        targetEpic
      );
      if (!isInside) {
        return computeTaskPositionInEpic(projectId, newEpicId);
      }
    }
    return { canvasX: currentTask.canvas_x, canvasY: currentTask.canvas_y };
  }

  // If moving out of an Epic to independent
  if (currentTask.epic_id !== null) {
    const oldEpic = db
      .prepare('SELECT * FROM epics WHERE id = ?')
      .get(currentTask.epic_id) as EpicRow | undefined;

    if (oldEpic) {
      const isStillInside = isTaskCenterInsideEpic(
        currentTask.canvas_x,
        currentTask.canvas_y,
        oldEpic
      );
      if (isStillInside) {
        return computeIndependentTaskPosition(projectId);
      }
    }
  }

  return { canvasX: currentTask.canvas_x, canvasY: currentTask.canvas_y };
}
