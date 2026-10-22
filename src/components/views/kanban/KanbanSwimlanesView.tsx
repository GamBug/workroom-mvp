import React, { useState } from 'react';
import type { Task, Epic, User, Subtask, TaskDependency, TaskStatus } from '../../../types/workroom';
import { COLUMNS } from './kanbanTypes';
import KanbanTaskCard from './KanbanTaskCard';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';

interface KanbanSwimlanesViewProps {
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
  onOpenCreateTask: (status: TaskStatus, epicId: string | null) => void;
}

export default function KanbanSwimlanesView({
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
}: KanbanSwimlanesViewProps) {
  const [collapsedSwimlanes, setCollapsedSwimlanes] = useState<Record<string, boolean>>({});

  const toggleSwimlane = (key: string) => {
    setCollapsedSwimlanes((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderSwimlaneColumns = (epicId: string | null, laneTasks: Task[]) => (
    <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 bg-zinc-50/50">
      {COLUMNS.map((col) => {
        const colTasks = laneTasks.filter((t) => t.status === col.id);
        const targetKey = `swimlane-${epicId ?? 'none'}-${col.id}`;
        const isOver = dropTargetKey === targetKey;

        return (
          <div
            key={col.id}
            onDragOver={(e) => onDragOver(e, targetKey)}
            onDragLeave={(e) => onDragLeave(e, targetKey)}
            onDrop={(e) => onDrop(e, col.id, epicId)}
            className={`flex-1 rounded-lg p-2 transition-all duration-150 flex flex-col gap-2.5 border min-h-[200px] ${
              isOver
                ? 'ring-2 ring-zinc-400 bg-white/95 border-zinc-300'
                : 'bg-white/60 border-zinc-200/80 hover:border-zinc-300'
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
                <div className="h-20 flex items-center justify-center text-[11px] text-zinc-400 border border-dashed border-zinc-200 rounded-lg">
                  Kéo thả vào đây
                </div>
              )}
            </div>

            <button
              onClick={() => onOpenCreateTask(col.id, epicId)}
              className="w-full py-1.5 rounded-lg border border-dashed border-zinc-300 hover:border-zinc-400 text-zinc-500 hover:text-zinc-800 text-xs font-medium transition flex items-center justify-center gap-1 group bg-white hover:bg-zinc-50"
            >
              <Plus className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-800 transition" />
              <span>Thêm Task</span>
            </button>
          </div>
        );
      })}
    </div>
  );

  const unassignedTasks = tasks.filter((t) => t.epicId === null);

  return (
    <div className="space-y-4 pb-6">
      {/* Sticky Top Status Header */}
      <div className="grid grid-cols-4 gap-4 px-3 py-1.5 bg-white/95 rounded-lg border border-zinc-200 text-center sticky top-0 z-10 backdrop-blur shadow-2xs">
        {COLUMNS.map((col) => (
          <div key={col.id} className="flex items-center justify-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: col.dotColor }}
            />
            <span className="text-xs font-medium text-zinc-700">
              {col.title}
            </span>
            <span className="text-[11px] font-mono text-zinc-400">
              {tasks.filter((t) => t.status === col.id).length}
            </span>
          </div>
        ))}
      </div>

      {/* Epics Swimlanes */}
      {epics.map((epic) => {
        const isCollapsed = !!collapsedSwimlanes[epic.id];
        const epicTasks = tasks.filter((t) => t.epicId === epic.id);

        return (
          <div
            key={epic.id}
            className="bg-white border rounded-xl overflow-hidden shadow-xs transition"
            style={{ borderColor: `${epic.color}50` }}
          >
            {/* Header */}
            <div
              onClick={() => toggleSwimlane(epic.id)}
              className="px-4 py-2.5 bg-zinc-50/80 border-b flex items-center justify-between cursor-pointer select-none"
              style={{ borderBottomColor: `${epic.color}30` }}
            >
              <div className="flex items-center gap-2.5">
                <button className="text-zinc-400 hover:text-zinc-700">
                  {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: epic.color }}
                />
                <h4 className="text-xs font-semibold text-zinc-800 tracking-wide">{epic.title}</h4>
                <span className="text-[10px] font-mono text-zinc-500 bg-white px-2 py-0.5 rounded-md border border-zinc-200">
                  {epicTasks.length} tasks
                </span>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenCreateTask('todo', epic.id);
                }}
                className="px-2.5 py-1 rounded-lg bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50 text-[11px] font-medium transition flex items-center gap-1 shadow-xs"
              >
                <Plus className="w-3 h-3 text-zinc-500" />
                <span>Thêm vào Epic</span>
              </button>
            </div>

            {/* Columns */}
            {!isCollapsed && renderSwimlaneColumns(epic.id, epicTasks)}
          </div>
        );
      })}

      {/* Unassigned Tasks Swimlane */}
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-xs transition">
        <div
          onClick={() => toggleSwimlane('none')}
          className="px-4 py-2.5 bg-zinc-50/80 border-b border-zinc-200 flex items-center justify-between cursor-pointer select-none"
        >
          <div className="flex items-center gap-2.5">
            <button className="text-zinc-400 hover:text-zinc-700">
              {collapsedSwimlanes['none'] ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-400 flex-shrink-0" />
            <h4 className="text-xs font-semibold text-zinc-700 tracking-wide">
              Tasks độc lập (Không thuộc Epic)
            </h4>
            <span className="text-[10px] font-mono text-zinc-500 bg-white px-2 py-0.5 rounded-md border border-zinc-200">
              {unassignedTasks.length} tasks
            </span>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenCreateTask('todo', null);
            }}
            className="px-2.5 py-1 rounded-lg bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50 text-[11px] font-medium transition flex items-center gap-1 shadow-xs"
          >
            <Plus className="w-3 h-3 text-zinc-500" />
            <span>Thêm Task độc lập</span>
          </button>
        </div>

        {!collapsedSwimlanes['none'] && renderSwimlaneColumns(null, unassignedTasks)}
      </div>
    </div>
  );
}
