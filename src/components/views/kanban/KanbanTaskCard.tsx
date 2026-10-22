import React from 'react';
import type { Task, Epic, User, Subtask, TaskDependency } from '../../../types/workroom';
import {
  CheckSquare,
  Lock,
  FileText,
  User as UserIcon,
} from 'lucide-react';
import { useWorkroomStore } from '../../../store/useWorkroomStore';
import { extractMentionedDocIds } from '../../../utils/docMentions';

interface KanbanTaskCardProps {
  task: Task;
  epic?: Epic;
  assignee?: User;
  subtasks: Subtask[];
  dependencies: TaskDependency[];
  allTasks: Task[];
  onCardClick: (taskId: string) => void;
  onDragStart: (e: React.DragEvent, task: Task) => void;
}

export default function KanbanTaskCard({
  task,
  epic,
  assignee,
  subtasks,
  dependencies,
  allTasks,
  onCardClick,
  onDragStart,
}: KanbanTaskCardProps) {
  const { setActivePreviewDocId } = useWorkroomStore();
  const mentionedDocIds = extractMentionedDocIds(task.description);

  // Subtasks progress
  const completedSubs = subtasks.filter((s) => s.isCompleted);

  // Prerequisites check (tasks that must finish before this task)
  const prereqs = dependencies.filter((d) => d.targetTaskId === task.id);
  const hasUnfinishedPrereqs = prereqs.some((d) => {
    const src = allTasks.find((t) => t.id === d.sourceTaskId);
    return src && src.status !== 'done';
  });

  const priorityDotColor =
    task.priority === 'high'
      ? 'bg-red-500'
      : task.priority === 'medium'
      ? 'bg-amber-500'
      : 'bg-zinc-400';

  const priorityLabel =
    task.priority === 'high' ? 'High' : task.priority === 'medium' ? 'Med' : 'Low';

  const hasMeta =
    subtasks.length > 0 || mentionedDocIds.length > 0 || (prereqs.length > 0 && hasUnfinishedPrereqs);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onClick={() => onCardClick(task.id)}
      className="group bg-white hover:bg-zinc-50/50 border border-zinc-200/90 hover:border-zinc-300 rounded-md p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:shadow-xs transition-all cursor-grab active:cursor-grabbing space-y-2 select-none"
    >
      {/* Top Header: Epic & Priority (Flat inline, no boxes) */}
      <div className="flex items-center justify-between gap-2">
        {epic ? (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 truncate max-w-[140px]"
            title={epic.title}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: epic.color }}
            />
            <span className="truncate">{epic.title}</span>
          </span>
        ) : (
          <span className="text-[11px] text-zinc-400">Độc lập</span>
        )}

        {/* Priority: Dot + Title Case (no uppercase, no box) */}
        <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500 font-normal flex-shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${priorityDotColor}`} />
          <span>{priorityLabel}</span>
        </span>
      </div>

      {/* Task Title */}
      <h4 className="text-[13px] font-medium text-zinc-900 leading-snug line-clamp-2">
        {task.title}
      </h4>

      {/* Footer: Metadata & Assignee (Flat inline) */}
      <div className="pt-2 flex items-center justify-between text-zinc-400 border-t border-zinc-100">
        <div className="flex items-center gap-2.5">
          {/* Subtasks inline */}
          {subtasks.length > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-zinc-400 font-normal"
              title={`${completedSubs.length}/${subtasks.length} subtasks hoàn thành`}
            >
              <CheckSquare className="w-3.5 h-3.5" strokeWidth={1.75} />
              <span>{completedSubs.length}/{subtasks.length}</span>
            </span>
          )}

          {/* Attached Docs inline */}
          {mentionedDocIds.length > 0 && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                setActivePreviewDocId(mentionedDocIds[0]);
              }}
              className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-700 font-normal cursor-pointer transition"
              title={`${mentionedDocIds.length} tài liệu đính kèm (Bấm để xem)`}
            >
              <FileText className="w-3.5 h-3.5" strokeWidth={1.75} />
              <span>{mentionedDocIds.length}</span>
            </span>
          )}

          {/* Blocked dependency: Flat amber lock, no box */}
          {prereqs.length > 0 && hasUnfinishedPrereqs && (
            <span
              title={`Chờ ${prereqs.length} task tiền đề hoàn thành`}
              className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-normal"
            >
              <Lock className="w-3.5 h-3.5 text-amber-600" strokeWidth={1.75} />
              <span>Chờ</span>
            </span>
          )}
        </div>

        {/* Assignee Avatar */}
        {assignee ? (
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium text-white shadow-2xs flex-shrink-0"
            style={{ backgroundColor: assignee.avatarColor }}
            title={`${assignee.displayName} (@${assignee.username})`}
          >
            {assignee.displayName[0]?.toUpperCase() || assignee.username[0]?.toUpperCase()}
          </div>
        ) : (
          <div
            className="w-5 h-5 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-300 flex-shrink-0"
            title="Chưa phân công"
          >
            <UserIcon className="w-2.5 h-2.5" />
          </div>
        )}
      </div>
    </div>
  );
}
