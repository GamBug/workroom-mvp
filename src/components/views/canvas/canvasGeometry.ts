import type { Epic, Task } from '../../../types/workroom';

export const TASK_WIDTH = 260;
export const TASK_HEIGHT = 110;
export const TASK_CENTER_OFFSET_X = 130;
export const TASK_CENTER_OFFSET_Y = 55;
export const TASK_PORT_OFFSET_Y = 55;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Calculates the center point of a task card
 */
export function getTaskCenter(taskX: number, taskY: number): Point {
  return {
    x: taskX + TASK_CENTER_OFFSET_X,
    y: taskY + TASK_CENTER_OFFSET_Y,
  };
}

/**
 * Checks if a point is within a rectangular bounding box
 */
export function isPointInRect(pt: Point, rect: Rect): boolean {
  return (
    pt.x >= rect.x &&
    pt.x <= rect.x + rect.width &&
    pt.y >= rect.y &&
    pt.y <= rect.y + rect.height
  );
}

/**
 * Finds the epic container whose bounding box contains the center of the task card
 */
export function findContainingEpic(
  taskX: number,
  taskY: number,
  epics: Epic[]
): Epic | null {
  const center = getTaskCenter(taskX, taskY);
  for (const epic of epics) {
    if (
      isPointInRect(center, {
        x: epic.canvasX,
        y: epic.canvasY,
        width: epic.canvasWidth,
        height: epic.canvasHeight,
      })
    ) {
      return epic;
    }
  }
  return null;
}

/**
 * Generates an SVG Cubic Bezier path between two coordinate ports
 */
export function createBezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const dx = Math.abs(x2 - x1);
  const curvature = Math.max(dx * 0.5, 45);
  const cx1 = x1 + curvature;
  const cy1 = y1;
  const cx2 = x2 - curvature;
  const cy2 = y2;
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

/**
 * Calculates the exact midpoint (t = 0.5) along the Cubic Bezier curve
 */
export function getBezierMidpoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Point {
  const dx = Math.abs(x2 - x1);
  const curvature = Math.max(dx * 0.5, 45);
  const cx1 = x1 + curvature;
  const cy1 = y1;
  const cx2 = x2 - curvature;
  const cy2 = y2;

  // Cubic Bezier formula at t = 0.5: 0.125*P0 + 0.375*P1 + 0.375*P2 + 0.125*P3
  const mx = 0.125 * x1 + 0.375 * cx1 + 0.375 * cx2 + 0.125 * x2;
  const my = 0.125 * y1 + 0.375 * cy1 + 0.375 * cy2 + 0.125 * y2;
  return { x: mx, y: my };
}

/**
 * Calculates clean non-overlapping coordinates for Epics and member/independent Tasks
 */
export function calculateAutoLayout(epics: Epic[], tasks: Task[]) {
  const epicUpdates: Array<{
    id: string;
    canvasX: number;
    canvasY: number;
    canvasWidth: number;
    canvasHeight: number;
  }> = [];

  const taskUpdates: Array<{
    id: string;
    canvasX: number;
    canvasY: number;
    epicId: string | null;
  }> = [];

  const startX = 80;
  const startY = 80;
  let currentEpicX = startX;
  const epicGap = 60;
  let maxEpicHeight = 360;

  // 1. Position each Epic and its member tasks
  epics.forEach((epic) => {
    const memberTasks = tasks.filter((t) => t.epicId === epic.id);
    const cols = 2;
    const taskColWidth = 280;
    const taskRowHeight = 135;
    const paddingX = 28;
    const headerOffsetY = 65;

    // Dynamically size the Epic frame to snugly fit member tasks
    const numRows = Math.max(Math.ceil(memberTasks.length / cols), 2);
    const epicWidth = Math.max(cols * taskColWidth + paddingX * 2, 540);
    const epicHeight = Math.max(numRows * taskRowHeight + headerOffsetY + 30, 360);

    epicUpdates.push({
      id: epic.id,
      canvasX: currentEpicX,
      canvasY: startY,
      canvasWidth: epicWidth,
      canvasHeight: epicHeight,
    });

    if (epicHeight > maxEpicHeight) {
      maxEpicHeight = epicHeight;
    }

    // Lay out tasks inside this Epic
    memberTasks.forEach((task, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const taskX = currentEpicX + paddingX + col * taskColWidth;
      const taskY = startY + headerOffsetY + row * taskRowHeight;

      taskUpdates.push({
        id: task.id,
        canvasX: taskX,
        canvasY: taskY,
        epicId: epic.id,
      });
    });

    currentEpicX += epicWidth + epicGap;
  });

  // 2. Position independent tasks to the right in neat columns
  const unassignedTasks = tasks.filter((t) => !t.epicId);
  if (unassignedTasks.length > 0) {
    const unassignedStartX = epics.length > 0 ? currentEpicX + 20 : startX;
    const cols = 2;
    const taskColWidth = 280;
    const taskRowHeight = 135;

    unassignedTasks.forEach((task, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const taskX = unassignedStartX + col * taskColWidth;
      const taskY = startY + 40 + row * taskRowHeight;

      taskUpdates.push({
        id: task.id,
        canvasX: taskX,
        canvasY: taskY,
        epicId: null,
      });
    });
  }

  return { epics: epicUpdates, tasks: taskUpdates };
}
