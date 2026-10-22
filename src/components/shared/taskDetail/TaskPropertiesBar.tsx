import React from 'react';
import { Clock, Flag, Layers, User as UserIcon } from 'lucide-react';
import type { Task, Epic, User, TaskStatus, TaskPriority } from '../../../types/workroom';

interface TaskPropertiesBarProps {
  task: Task;
  epics: Epic[];
  users: User[];
  onStatusChange: (status: TaskStatus) => void;
  onPriorityChange: (priority: TaskPriority) => void;
  onEpicChange: (epicId: string) => void;
  onAssigneeChange: (assigneeId: string) => void;
}

export default function TaskPropertiesBar({
  task,
  epics,
  users,
  onStatusChange,
  onPriorityChange,
  onEpicChange,
  onAssigneeChange,
}: TaskPropertiesBarProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3.5 rounded-xl bg-zinc-50 border border-zinc-200">
      {/* Status */}
      <div>
        <label className="text-[11px] font-medium text-zinc-500 flex items-center gap-1 mb-1.5">
          <Clock className="w-3 h-3 text-zinc-400" strokeWidth={1.75} />
          Trạng thái
        </label>
        <select
          value={task.status}
          onChange={(e) => onStatusChange(e.target.value as TaskStatus)}
          className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-zinc-400 transition"
        >
          <option value="todo">Chưa làm (Todo)</option>
          <option value="in_progress">Đang làm (In Progress)</option>
          <option value="review">Kiểm tra (Review)</option>
          <option value="done">Hoàn thành (Done)</option>
        </select>
      </div>

      {/* Priority */}
      <div>
        <label className="text-[11px] font-medium text-zinc-500 flex items-center gap-1 mb-1.5">
          <Flag className="w-3 h-3 text-zinc-400" strokeWidth={1.75} />
          Độ ưu tiên
        </label>
        <select
          value={task.priority}
          onChange={(e) => onPriorityChange(e.target.value as TaskPriority)}
          className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-zinc-400 transition"
        >
          <option value="low">Thấp (Low)</option>
          <option value="medium">Trung bình (Medium)</option>
          <option value="high">Cao (High)</option>
        </select>
      </div>

      {/* Epic (Optional) */}
      <div>
        <label className="text-[11px] font-medium text-zinc-500 flex items-center gap-1 mb-1.5">
          <Layers className="w-3 h-3 text-zinc-400" strokeWidth={1.75} />
          Khung Epic
        </label>
        <select
          value={task.epicId || ''}
          onChange={(e) => onEpicChange(e.target.value)}
          className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-zinc-400 truncate transition"
        >
          <option value="">Không thuộc Epic (Tự do)</option>
          {epics.map((epic) => (
            <option key={epic.id} value={epic.id}>
              {epic.title}
            </option>
          ))}
        </select>
      </div>

      {/* Assignee */}
      <div>
        <label className="text-[11px] font-medium text-zinc-500 flex items-center gap-1 mb-1.5">
          <UserIcon className="w-3 h-3 text-zinc-400" strokeWidth={1.75} />
          Người phụ trách
        </label>
        <select
          value={task.assigneeId || ''}
          onChange={(e) => onAssigneeChange(e.target.value)}
          className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-zinc-400 truncate transition"
        >
          <option value="">Chưa phân công</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} (@{u.username})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
