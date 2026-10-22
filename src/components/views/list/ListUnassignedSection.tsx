import React from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { Task, Subtask, TaskDependency, User } from '../../../types/workroom';
import ListTaskRow from './ListTaskRow';

interface ListUnassignedSectionProps {
  unassignedTasks: Task[];
  allTasks: Task[];
  subtasks: Subtask[];
  dependencies: TaskDependency[];
  users: User[];
  isCollapsed: boolean;
  expandedTasks: Record<string, boolean>;
  quickSubtaskInputs: Record<string, string>;
  onToggleCollapse: () => void;
  onToggleTaskAccordion: (taskId: string) => void;
  onQuickSubtaskInputChange: (taskId: string, val: string) => void;
  onQuickAddSubtask: (e: React.FormEvent, taskId: string) => void;
  onSelectTask: (taskId: string) => void;
  onUpdateTask: (taskId: string, payload: Partial<Task>) => void;
  onDeleteTask: (taskId: string, title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onPreviewDoc: (docId: string) => void;
  onOpenCreateTask: () => void;
}

export default function ListUnassignedSection({
  unassignedTasks,
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
  onOpenCreateTask,
}: ListUnassignedSectionProps) {
  const completedCount = unassignedTasks.filter((t) => t.status === 'done').length;

  return (
    <div className="bg-white border border-zinc-200/80 rounded-lg overflow-hidden shadow-2xs group/unassigned">
      {/* Header */}
      <div
        className="h-8 px-3 flex items-center justify-between gap-3 bg-zinc-50/70 border-b border-zinc-200/80 cursor-pointer select-none"
        onClick={onToggleCollapse}
      >
        <div className="flex items-center gap-2">
          <button className="text-zinc-400 hover:text-zinc-700 transition cursor-pointer">
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.75} />
            )}
          </button>

          <span className="w-2 h-2 rounded-full bg-zinc-400 flex-shrink-0" />

          <h3 className="text-[12px] font-semibold text-zinc-700 tracking-tight">
            Tasks độc lập (Không thuộc Epic)
          </h3>

          <span className="text-[11px] font-mono text-zinc-400">
            {completedCount}/{unassignedTasks.length}
          </span>
        </div>

        <div
          className="opacity-0 group-hover/unassigned:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onOpenCreateTask}
            className="px-2 py-0.5 rounded text-[11px] font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer flex items-center gap-1"
            title="Thêm Task độc lập"
          >
            <Plus className="w-3 h-3" strokeWidth={2} />
            <span>Thêm Task</span>
          </button>
        </div>
      </div>

      {/* Tasks List */}
      {!isCollapsed && (
        <div>
          {unassignedTasks.length === 0 ? (
            <div className="px-4 py-4 text-center text-xs text-zinc-400">
              Không có task độc lập nào.
            </div>
          ) : (
            <div>
              {unassignedTasks.map((task) => (
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
