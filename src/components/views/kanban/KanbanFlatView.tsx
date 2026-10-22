import React from 'react';
import type { Task, Epic, User, Subtask, TaskDependency, TaskStatus } from '../../../types/workroom';
import { COLUMNS } from './kanbanTypes';
import KanbanTaskCard from './KanbanTaskCard';
import { Plus } from 'lucide-react';

interface KanbanFlatViewProps {
  tasks: Task[];
  allTasks: Task[];
  epics: Epic[];
  users: User[];
  subtasks: Subtask[];
  dependencies: TaskDependency[];
  dropTargetKey: string | null;
  onDragStart: (e: React.DragEvent, task: Task) => void;
  onDragOver: (e: React.DragEvent, targetKey: string) => void;
  onDragLeave: (e: React.DragEvent, targetKey: string) => void;
  onDrop: (e: React.DragEvent, targetStatus: TaskStatus, targetEpicId?: string | null) => void;
  onCardClick: (taskId: string) => void;
  onOpenCreateTask: (status: TaskStatus) => void;
}

export default function KanbanFlatView({
  tasks,
  allTasks,
  epics,
  users,
  subtasks,
  dependencies,
  dropTargetKey,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onCardClick,
  onOpenCreateTask,
}: KanbanFlatViewProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 h-full min-h-[500px]">
      {COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.id);
        const targetKey = `flat-${col.id}`;
        const isOver = dropTargetKey === targetKey;

        return (
          <div
            key={col.id}
            className="bg-zinc-100/80 border border-zinc-200/80 rounded-xl p-3 flex flex-col flex-1"
          >
            {/* Column Header */}
            <div className="flex items-center justify-between pb-2 px-1 border-b border-zinc-200/80 mb-2">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: col.dotColor }}
                />
                <h3 className="text-xs font-medium text-zinc-800">
                  {col.title}
                </h3>
              </div>

              <span className="text-[11px] font-mono text-zinc-400 font-normal">
                {colTasks.length}
              </span>
            </div>

            {/* Drop Container */}
            <div
              onDragOver={(e) => onDragOver(e, targetKey)}
              onDragLeave={(e) => onDragLeave(e, targetKey)}
              onDrop={(e) => onDrop(e, col.id)}
              className={`flex-1 rounded-lg p-1.5 transition-all duration-150 flex flex-col gap-2.5 border min-h-[350px] ${
                isOver
                  ? 'ring-2 ring-zinc-400 bg-white/90 border-zinc-300'
                  : 'bg-zinc-50/50 border-transparent hover:border-zinc-200/50'
              }`}
            >
              <div className="flex-1 space-y-2.5">
                {colTasks.map((task) => (
                  <KanbanTaskCard
                    key={task.id}
                    task={task}
                    epic={epics.find((e) => e.id === task.epicId)}
                    assignee={users.find((u) => u.id === task.assigneeId)}
                    subtasks={subtasks.filter((s) => s.taskId === task.id)}
                    dependencies={dependencies}
                    allTasks={allTasks}
                    onCardClick={onCardClick}
                    onDragStart={onDragStart}
                  />
                ))}

                {colTasks.length === 0 && (
                  <div className="h-28 flex items-center justify-center text-[11px] text-zinc-400 border border-dashed border-zinc-300 rounded-lg">
                    Kéo thả vào đây
                  </div>
                )}
              </div>

              {/* Quick Add at column bottom */}
              <button
                onClick={() => onOpenCreateTask(col.id)}
                className="w-full py-1.5 rounded-lg border border-dashed border-zinc-300 hover:border-zinc-400 text-zinc-500 hover:text-zinc-800 text-xs font-medium transition flex items-center justify-center gap-1 group bg-white/60 hover:bg-white"
              >
                <Plus className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-800 transition" />
                <span>Thêm Task</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
