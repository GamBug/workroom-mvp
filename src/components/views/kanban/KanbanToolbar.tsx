import React from 'react';
import { Columns, LayoutGrid, Plus, Search } from 'lucide-react';
import type { User } from '../../../types/workroom';
import type { KanbanMode } from './kanbanTypes';

interface KanbanToolbarProps {
  mode: KanbanMode;
  onModeChange: (m: KanbanMode) => void;
  searchTerm: string;
  onSearchChange: (s: string) => void;
  priorityFilter: string;
  onPriorityFilterChange: (p: string) => void;
  assigneeFilter: string;
  onAssigneeFilterChange: (a: string) => void;
  users: User[];
  onOpenCreateTask: () => void;
}

export default function KanbanToolbar({
  mode,
  onModeChange,
  searchTerm,
  onSearchChange,
  priorityFilter,
  onPriorityFilterChange,
  assigneeFilter,
  onAssigneeFilterChange,
  users,
  onOpenCreateTask,
}: KanbanToolbarProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-zinc-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] flex-shrink-0">
      <div className="flex flex-wrap items-center gap-2.5 flex-1">
        {/* Flat vs Swimlanes Mode Switcher */}
        <div className="flex items-center p-0.5 bg-zinc-100 rounded-lg border border-zinc-200/80">
          <button
            onClick={() => onModeChange('flat')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition ${
              mode === 'flat'
                ? 'bg-white text-zinc-900 font-semibold shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 font-medium'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Cột phẳng</span>
          </button>

          <button
            onClick={() => onModeChange('swimlanes')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition ${
              mode === 'swimlanes'
                ? 'bg-white text-zinc-900 font-semibold shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 font-medium'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Gom theo Epic</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative min-w-[180px] flex-1 sm:flex-initial">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Tìm kiếm task..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-zinc-50 border border-zinc-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:bg-white focus:outline-none focus:border-zinc-400 transition"
          />
        </div>

        {/* Priority Filter */}
        <select
          value={priorityFilter}
          onChange={(e) => onPriorityFilterChange(e.target.value)}
          className="bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs text-zinc-700 focus:bg-white focus:outline-none focus:border-zinc-400 transition"
        >
          <option value="all">Tất cả Độ ưu tiên</option>
          <option value="high">Cao (High)</option>
          <option value="medium">Trung bình (Medium)</option>
          <option value="low">Thấp (Low)</option>
        </select>

        {/* Assignee Filter */}
        <select
          value={assigneeFilter}
          onChange={(e) => onAssigneeFilterChange(e.target.value)}
          className="bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs text-zinc-700 focus:bg-white focus:outline-none focus:border-zinc-400 transition"
        >
          <option value="all">Tất cả Người phụ trách</option>
          <option value="unassigned">Chưa phân công</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </select>
      </div>

      {/* New Task Button */}
      <button
        onClick={onOpenCreateTask}
        className="px-3.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium rounded-lg transition flex items-center gap-1.5 shadow-xs self-start md:self-auto"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>Tạo Task mới</span>
      </button>
    </div>
  );
}
