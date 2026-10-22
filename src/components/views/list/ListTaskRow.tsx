import React from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Lock,
  Trash2,
  FileText,
} from 'lucide-react';
import type { Task, Subtask, TaskDependency, User, TaskStatus } from '../../../types/workroom';
import { extractMentionedDocIds } from '../../../utils/docMentions';

interface ListTaskRowProps {
  task: Task;
  subtasks: Subtask[];
  dependencies: TaskDependency[];
  allTasks: Task[];
  users: User[];
  isExpanded: boolean;
  quickSubtaskInput: string;
  onToggleAccordion: (taskId: string) => void;
  onQuickSubtaskInputChange: (taskId: string, val: string) => void;
  onQuickAddSubtask: (e: React.FormEvent, taskId: string) => void;
  onSelectTask: (taskId: string) => void;
  onUpdateTask: (taskId: string, payload: Partial<Task>) => void;
  onDeleteTask: (taskId: string, title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onPreviewDoc: (docId: string) => void;
}

export default function ListTaskRow({
  task,
  subtasks,
  dependencies,
  allTasks,
  users,
  isExpanded,
  quickSubtaskInput,
  onToggleAccordion,
  onQuickSubtaskInputChange,
  onQuickAddSubtask,
  onSelectTask,
  onUpdateTask,
  onDeleteTask,
  onToggleSubtask,
  onPreviewDoc,
}: ListTaskRowProps) {
  const taskSubtasks = subtasks.filter((s) => s.taskId === task.id);
  const completedSubs = taskSubtasks.filter((s) => s.isCompleted);

  // Prerequisites check
  const taskPrereqs = dependencies.filter((d) => d.targetTaskId === task.id);
  const hasUnfinishedPrereq = taskPrereqs.some((d) => {
    const src = allTasks.find((t) => t.id === d.sourceTaskId);
    return src && src.status !== 'done';
  });

  const assignee = users.find((u) => u.id === task.assigneeId);
  const mentionedDocIds = extractMentionedDocIds(task.description);

  const priorityDotColor =
    task.priority === 'high'
      ? 'bg-red-500'
      : task.priority === 'medium'
      ? 'bg-amber-500'
      : 'bg-zinc-400';

  const priorityLabel =
    task.priority === 'high' ? 'High' : task.priority === 'medium' ? 'Med' : 'Low';

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

  return (
    <div className="border-b border-zinc-100 last:border-b-0 group">
      {/* Hairline Linear Row (h-9) */}
      <div className="h-9 px-3 flex items-center justify-between gap-3 text-[13px] hover:bg-zinc-50/80 transition-colors select-none">
        {/* Left: Accordion Toggle + Status Dot + Title + Inline Flat Metadata */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={() => onToggleAccordion(task.id)}
            className="p-0.5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition flex-shrink-0 cursor-pointer"
            title={isExpanded ? 'Thu gọn subtasks' : 'Mở rộng subtasks'}
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-700" strokeWidth={1.75} />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
            )}
          </button>

          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusDotColor()}`}
            title={`Trạng thái: ${task.status}`}
          />

          <span
            onClick={() => onSelectTask(task.id)}
            className={`font-medium cursor-pointer hover:text-zinc-900 transition-colors truncate max-w-md ${
              task.status === 'done' ? 'line-through text-zinc-400' : 'text-zinc-800'
            }`}
          >
            {task.title}
          </span>

          {/* Subtasks Count Flat Inline */}
          {taskSubtasks.length > 0 && (
            <span
              onClick={() => onToggleAccordion(task.id)}
              className="inline-flex items-center gap-1 text-[11px] text-zinc-400 font-normal hover:text-zinc-700 cursor-pointer flex-shrink-0 transition-colors"
            >
              <CheckSquare className="w-3.5 h-3.5" strokeWidth={1.75} />
              <span>{completedSubs.length}/{taskSubtasks.length}</span>
            </span>
          )}

          {/* Attached Docs Flat Inline */}
          {mentionedDocIds.length > 0 && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onPreviewDoc(mentionedDocIds[0]);
              }}
              className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-700 font-normal cursor-pointer flex-shrink-0 transition-colors"
              title={`${mentionedDocIds.length} tài liệu đính kèm`}
            >
              <FileText className="w-3.5 h-3.5" strokeWidth={1.75} />
              <span>{mentionedDocIds.length}</span>
            </span>
          )}

          {/* Dependency Lock Flat Amber */}
          {taskPrereqs.length > 0 && hasUnfinishedPrereq && (
            <span
              onClick={() => onSelectTask(task.id)}
              className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-normal cursor-pointer flex-shrink-0"
              title={`Chờ ${taskPrereqs.length} task tiền đề hoàn thành`}
            >
              <Lock className="w-3.5 h-3.5 text-amber-600" strokeWidth={1.75} />
              <span>Chờ</span>
            </span>
          )}
        </div>

        {/* Right: Quick Status, Priority Dot, Assignee Avatar, Delete */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Quick Status Select */}
          <select
            value={task.status}
            onChange={(e) => onUpdateTask(task.id, { status: e.target.value as TaskStatus })}
            className="bg-transparent hover:bg-zinc-100 border-none rounded px-1.5 py-0.5 text-[12px] text-zinc-600 focus:outline-none cursor-pointer transition-colors"
          >
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="review">Review</option>
            <option value="done">Done</option>
          </select>

          {/* Priority: Dot + Text (no box, title case) */}
          <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500 font-normal">
            <span className={`w-1.5 h-1.5 rounded-full ${priorityDotColor}`} />
            <span>{priorityLabel}</span>
          </span>

          {/* Assignee Avatar */}
          {assignee ? (
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium text-white shadow-2xs"
              style={{ backgroundColor: assignee.avatarColor }}
              title={`${assignee.displayName} (@${assignee.username})`}
            >
              {assignee.displayName[0]?.toUpperCase() || assignee.username[0]?.toUpperCase()}
            </div>
          ) : (
            <div className="w-5 h-5" />
          )}

          {/* Delete Ghost Button */}
          <button
            onClick={() => onDeleteTask(task.id, task.title)}
            className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 transition opacity-0 group-hover:opacity-100 cursor-pointer"
            title="Xóa Task"
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Inline Subtasks Accordion */}
      {isExpanded && (
        <div className="pl-8 pr-4 py-2 bg-zinc-50/50 border-t border-zinc-100 space-y-1.5">
          {taskSubtasks.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">Chưa có subtask con nào.</p>
          ) : (
            <div className="space-y-1">
              {taskSubtasks.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center gap-2 text-xs text-zinc-700 hover:text-zinc-900 cursor-pointer py-0.5"
                  onClick={() => onToggleSubtask(sub.id)}
                >
                  <input
                    type="checkbox"
                    checked={sub.isCompleted}
                    onChange={() => {}}
                    className="rounded border-zinc-300 text-zinc-900 focus:ring-0 cursor-pointer w-3.5 h-3.5"
                  />
                  <span className={sub.isCompleted ? 'line-through text-zinc-400' : ''}>
                    {sub.title}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Quick add subtask input */}
          <form onSubmit={(e) => onQuickAddSubtask(e, task.id)} className="flex gap-2 pt-1 max-w-sm">
            <input
              type="text"
              placeholder="+ Thêm subtask..."
              value={quickSubtaskInput || ''}
              onChange={(e) => onQuickSubtaskInputChange(task.id, e.target.value)}
              className="flex-1 bg-white border border-zinc-200 rounded px-2 py-0.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition"
            />
            <button
              type="submit"
              disabled={!quickSubtaskInput?.trim()}
              className="px-2 py-0.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-white rounded text-xs font-medium transition cursor-pointer"
            >
              Thêm
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
