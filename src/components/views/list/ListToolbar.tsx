import React from 'react';
import { Layers, Plus, Search } from 'lucide-react';
import type { User } from '../../../types/workroom';

interface ListToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  assigneeFilter: string;
  onAssigneeFilterChange: (value: string) => void;
  users: User[];
  onOpenCreateEpic: () => void;
  onOpenCreateTask: () => void;
}

export default function ListToolbar({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  assigneeFilter,
  onAssigneeFilterChange,
  users,
  onOpenCreateEpic,
  onOpenCreateTask,
}: ListToolbarProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 bg-white p-2.5 rounded-lg border border-zinc-200/80 shadow-2xs">
      {/* Left: Search & Filters */}
      <div className="flex flex-wrap items-center gap-2 flex-1">
        <div className="relative min-w-[180px] flex-1 sm:flex-initial">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" strokeWidth={1.75} />
          <input
            type="text"
            placeholder="Tìm kiếm task..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full h-7 bg-zinc-50 border border-zinc-200 rounded-md pl-7 pr-2.5 text-[12px] text-zinc-900 placeholder-zinc-400 focus:bg-white focus:outline-none focus:border-zinc-400 transition"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="h-7 bg-zinc-50 border border-zinc-200 rounded-md px-2 text-[12px] text-zinc-700 focus:bg-white focus:outline-none focus:border-zinc-400 cursor-pointer transition"
        >
          <option value="all">Tất cả Trạng thái</option>
          <option value="todo">To Do</option>
          <option value="in_progress">In Progress</option>
          <option value="review">In Review</option>
          <option value="done">Done</option>
        </select>

        <select
          value={assigneeFilter}
          onChange={(e) => onAssigneeFilterChange(e.target.value)}
          className="h-7 bg-zinc-50 border border-zinc-200 rounded-md px-2 text-[12px] text-zinc-700 focus:bg-white focus:outline-none focus:border-zinc-400 cursor-pointer transition"
        >
          <option value="all">Tất cả Thành viên</option>
          <option value="unassigned">Chưa phân công</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </select>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1.5 self-start md:self-auto">
        <button
          onClick={onOpenCreateEpic}
          className="h-7 px-2.5 bg-white hover:bg-zinc-50 text-zinc-700 text-[12px] font-medium rounded-md border border-zinc-200 transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
        >
          <Layers className="w-3.5 h-3.5 text-zinc-500" strokeWidth={1.75} />
          <span>+ Epic</span>
        </button>

        <button
          onClick={onOpenCreateTask}
          className="h-7 px-2.5 bg-zinc-900 hover:bg-zinc-800 text-white text-[12px] font-medium rounded-md transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          <span>+ Task</span>
        </button>
      </div>
    </div>
  );
}
