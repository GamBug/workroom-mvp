import React from 'react';
import { ChevronDown, ChevronRight, Edit2, Plus, Trash2 } from 'lucide-react';
import type { Epic, Task, Subtask, TaskDependency, User } from '../../../types/workroom';
import ListTaskRow from './ListTaskRow';

interface ListEpicSectionProps {
  epic: Epic;
  epicTasks: Task[];
  allTasks: Task[];
  subtasks: Subtask[];
  dependencies: TaskDependency[];
  users: User[];
  isCollapsed: boolean;
  expandedTasks: Record<string, boolean>;
  quickSubtaskInputs: Record<string, string>;
  onToggleCollapse: (epicId: string) => void;
  onToggleTaskAccordion: (taskId: string) => void;
  onQuickSubtaskInputChange: (taskId: string, val: string) => void;
  onQuickAddSubtask: (e: React.FormEvent, taskId: string) => void;
  onSelectTask: (taskId: string) => void;
  onUpdateTask: (taskId: string, payload: Partial<Task>) => void;
  onDeleteTask: (taskId: string, title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onPreviewDoc: (docId: string) => void;
  onOpenCreateTaskInEpic: (epicId: string) => void;
  onOpenEditEpic: (epicId: string, title: string, color: string) => void;
  onDeleteEpic: (epicId: string, title: string) => void;
}

export default function ListEpicSection({
  epic,
  epicTasks,
  allTasks,
  subtasks,
  dependencies,
  users,
  isCollapsed,
  expandedTasks,
  quickSubtaskInputs,
  onToggleCollapse,
  onToggleTaskAccordion,
  onQuickSubtaskInputChange,
  onQuickAddSubtask,
  onSelectTask,
  onUpdateTask,
  onDeleteTask,
  onToggleSubtask,
  onPreviewDoc,
  onOpenCreateTaskInEpic,
  onOpenEditEpic,
  onDeleteEpic,
}: ListEpicSectionProps) {
  const completedCount = epicTasks.filter((t) => t.status === 'done').length;

  return (
    <div
      className="bg-white border rounded-lg overflow-hidden shadow-2xs transition group/epic"
      style={{ borderColor: `${epic.color}40` }}
    >
      {/* Epic Header */}
      <div
        className="h-8 px-3 flex items-center justify-between gap-3 bg-zinc-50/70 border-b cursor-pointer select-none"
        style={{ borderBottomColor: `${epic.color}25` }}
        onClick={() => onToggleCollapse(epic.id)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button className="text-zinc-400 hover:text-zinc-700 transition cursor-pointer">
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.75} />
            )}
          </button>

          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: epic.color }}
          />

          <h3 className="text-[12px] font-semibold text-zinc-800 tracking-tight truncate">
            {epic.title}
          </h3>

          <span className="text-[11px] font-mono text-zinc-400">
            {completedCount}/{epicTasks.length}
          </span>
        </div>

        {/* Hover Controls */}
        <div
          className="flex items-center gap-1 opacity-0 group-hover/epic:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => onOpenCreateTaskInEpic(epic.id)}
            className="px-2 py-0.5 rounded text-[11px] font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer flex items-center gap-1"
            title="Thêm Task vào Epic này"
          >
            <Plus className="w-3 h-3" strokeWidth={2} />
            <span>Thêm Task</span>
          </button>

          <button
            onClick={() => onOpenEditEpic(epic.id, epic.title, epic.color)}
            className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition cursor-pointer"
            title="Sửa Epic"
          >
            <Edit2 className="w-3 h-3" strokeWidth={1.75} />
          </button>

          <button
            onClick={() => onDeleteEpic(epic.id, epic.title)}
            className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
            title="Xóa Epic"
          >
            <Trash2 className="w-3 h-3" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Epic Tasks List */}
      {!isCollapsed && (
        <div>
          {epicTasks.length === 0 ? (
            <div className="px-4 py-4 text-center text-xs text-zinc-400">
              Chưa có task nào trong Epic này.{' '}
              <button
                onClick={() => onOpenCreateTaskInEpic(epic.id)}
                className="text-zinc-800 font-medium hover:underline ml-1 cursor-pointer"
              >
                + Tạo ngay
              </button>
            </div>
          ) : (
            <div>
              {epicTasks.map((task) => (
                <ListTaskRow
                  key={task.id}
                  task={task}
                  subtasks={subtasks}
                  dependencies={dependencies}
                  allTasks={allTasks}
                  users={users}
                  isExpanded={!!expandedTasks[task.id]}
                  quickSubtaskInput={quickSubtaskInputs[task.id] || ''}
                  onToggleAccordion={onToggleTaskAccordion}
                  onQuickSubtaskInputChange={onQuickSubtaskInputChange}
                  onQuickAddSubtask={onQuickAddSubtask}
                  onSelectTask={onSelectTask}
                  onUpdateTask={onUpdateTask}
                  onDeleteTask={onDeleteTask}
                  onToggleSubtask={onToggleSubtask}
                  onPreviewDoc={onPreviewDoc}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
