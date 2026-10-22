import React from 'react';
import { useWorkroomStore } from '../../../store/useWorkroomStore';
import {
  CheckSquare,
  Lock,
  FileText,
  Plus,
} from 'lucide-react';
import { TASK_WIDTH, findContainingEpic } from './canvasGeometry';
import { extractMentionedDocIds } from '../../../utils/docMentions';
import type { Task, Epic } from '../../../types/workroom';

interface CanvasTaskNodeProps {
  task: Task;
  zoom: number;
  epics: Epic[];
  onHoverEpic: (epicId: string | null) => void;
  onStartConnect: (taskId: string, e: React.MouseEvent) => void;
  onEndConnect: (targetTaskId: string) => void;
}

export default function CanvasTaskNode({
  task,
  zoom,
  epics,
  onHoverEpic,
  onStartConnect,
  onEndConnect,
}: CanvasTaskNodeProps) {
  const {
    tasks,
    subtasks,
    dependencies,
    users,
    setSelectedTaskId,
    updateTask,
    selectedAssigneeFilter,
  } = useWorkroomStore();

  const isDimmed =
    selectedAssigneeFilter !== null && task.assigneeId !== selectedAssigneeFilter;

  const assignee = users.find((u) => u.id === task.assigneeId);

  // Subtask progress
  const taskSubtasks = subtasks.filter((s) => s.taskId === task.id);
  const completedSubtasks = taskSubtasks.filter((s) => s.isCompleted);

  // Check if blocked by unfinished dependencies
  const incomingDeps = dependencies.filter((d) => d.targetTaskId === task.id);
  const uncompletedPrereqs = incomingDeps.filter((dep) => {
    const src = tasks.find((t) => t.id === dep.sourceTaskId);
    return !src || src.status !== 'done';
  });
  const isBlocked = uncompletedPrereqs.length > 0;

  // Mentioned docs count
  const docIds = extractMentionedDocIds(task.description);

  // Drag task node
  const handleCardMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.port-btn, button')) return;
    e.stopPropagation();

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startTaskX = task.canvasX;
    const startTaskY = task.canvasY;

    let currentTaskX = startTaskX;
    let currentTaskY = startTaskY;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = (moveEvent.clientX - startClientX) / zoom;
      const dy = (moveEvent.clientY - startClientY) / zoom;

      currentTaskX = Math.round(startTaskX + dx);
      currentTaskY = Math.round(startTaskY + dy);

      const hoveringEpic = findContainingEpic(currentTaskX, currentTaskY, epics);
      onHoverEpic(hoveringEpic ? hoveringEpic.id : null);

      updateTask(task.id, {
        canvasX: currentTaskX,
        canvasY: currentTaskY,
        epicId: hoveringEpic ? hoveringEpic.id : null,
      });
    };

    const onMouseUp = async () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      onHoverEpic(null);

      const targetEpic = findContainingEpic(currentTaskX, currentTaskY, epics);
      await updateTask(task.id, {
        canvasX: currentTaskX,
        canvasY: currentTaskY,
        epicId: targetEpic ? targetEpic.id : null,
      });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const getStatusDotColor = () => {
    switch (task.status) {
      case 'done':
        return 'bg-emerald-500';
      case 'in_progress':
        return 'bg-amber-500';
      case 'review':
        return 'bg-purple-500';
      default:
        return 'bg-zinc-300';
    }
  };

  const hasFooter =
    taskSubtasks.length > 0 || docIds.length > 0 || isBlocked || assignee || task.priority !== 'low';

  return (
    <div
      style={{
        transform: `translate(${task.canvasX}px, ${task.canvasY}px)`,
        width: TASK_WIDTH || 240,
      }}
      onMouseDown={handleCardMouseDown}
      onDoubleClick={() => setSelectedTaskId(task.id)}
      className={`absolute top-0 left-0 rounded-md bg-white border border-zinc-200/90 hover:border-zinc-300 p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all cursor-grab active:cursor-grabbing select-none group z-10 ${
        isDimmed ? 'opacity-25 hover:opacity-80' : 'opacity-100'
      }`}
    >
      {/* Input Connection Port on Left Edge - Hidden by default */}
      <div
        onMouseUp={(e) => {
          e.stopPropagation();
          onEndConnect(task.id);
        }}
        title="Cổng nhận Dependency"
        className="port-btn absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border border-zinc-300 text-zinc-600 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 shadow-xs transition-opacity flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 z-20"
      >
        <div className="w-1 h-1 rounded-full bg-zinc-400 group-hover:bg-white" />
      </div>

      {/* Output Connection Port on Right Edge - Hidden by default */}
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          onStartConnect(task.id, e);
        }}
        title="Kéo để tạo liên kết Dependency"
        className="port-btn absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border border-zinc-300 text-zinc-600 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 shadow-xs transition-opacity flex items-center justify-center cursor-crosshair opacity-0 group-hover:opacity-100 z-20"
      >
        <Plus className="w-2.5 h-2.5" strokeWidth={2} />
      </div>

      {/* Row 1: Status Dot + Task Title */}
      <div className="flex items-start gap-2">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${getStatusDotColor()}`}
          title={`Trạng thái: ${task.status}`}
        />
        <h4 className="text-[13px] font-medium text-zinc-800 leading-snug line-clamp-2 flex-1">
          {task.title}
        </h4>
      </div>

      {/* Row 2 (Footer): Flat metadata (no boxes, no emojis, no uppercase priority) */}
      {hasFooter && (
        <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-2.5 mt-2 border-t border-zinc-100">
          <div className="flex items-center gap-2.5">
            {/* Priority dot + label (High / Med / Low) */}
            {task.priority !== 'low' && (
              <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500 font-normal">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    task.priority === 'high'
                      ? 'bg-red-500'
                      : task.priority === 'medium'
                      ? 'bg-amber-500'
                      : 'bg-zinc-400'
                  }`}
                />
                <span>{task.priority === 'high' ? 'High' : 'Med'}</span>
              </span>
            )}

            {/* Subtasks flat inline */}
            {taskSubtasks.length > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-zinc-400 font-normal"
                title={`${completedSubtasks.length}/${taskSubtasks.length} subtasks`}
              >
                <CheckSquare className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{completedSubtasks.length}/{taskSubtasks.length}</span>
              </span>
            )}

            {/* Attached docs flat inline */}
            {docIds.length > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-zinc-400 font-normal"
                title={`${docIds.length} tài liệu đính kèm`}
              >
                <FileText className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>{docIds.length}</span>
              </span>
            )}

            {/* Dependency lock: Flat amber icon + label (no box) */}
            {isBlocked && (
              <span
                title={`Chờ ${uncompletedPrereqs.length} task tiền đề hoàn thành`}
                className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-normal"
              >
                <Lock className="w-3.5 h-3.5 text-amber-600" strokeWidth={1.75} />
                <span>Chờ</span>
              </span>
            )}
          </div>

          {/* Assignee Avatar */}
          {assignee && (
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium text-white shadow-2xs flex-shrink-0"
              style={{ backgroundColor: assignee.avatarColor }}
              title={assignee.displayName}
            >
              {assignee.displayName[0]?.toUpperCase() || assignee.username[0]?.toUpperCase()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
