import React, { useState } from 'react';
import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
import type { Subtask } from '../../../types/workroom';

interface TaskSubtasksSectionProps {
  taskId: string;
  subtasks: Subtask[];
  onCreateSubtask: (payload: { taskId: string; title: string }) => Promise<any>;
  onToggleSubtask: (id: string) => Promise<any>;
  onDeleteSubtask: (id: string) => Promise<any>;
}

export default function TaskSubtasksSection({
  taskId,
  subtasks,
  onCreateSubtask,
  onToggleSubtask,
  onDeleteSubtask,
}: TaskSubtasksSectionProps) {
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  const completedSubtasks = subtasks.filter((s) => s.isCompleted);
  const percentComplete =
    subtasks.length > 0 ? Math.round((completedSubtasks.length / subtasks.length) * 100) : 0;

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtaskTitle.trim()) return;
    await onCreateSubtask({ taskId, title: newSubtaskTitle.trim() });
    setNewSubtaskTitle('');
  };

  return (
    <div className="space-y-3 p-4 rounded-xl bg-zinc-50 border border-zinc-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-zinc-700" />
          <h4 className="text-xs font-semibold text-zinc-800">
            Subtasks (Checklist)
          </h4>
        </div>
        <span className="text-xs font-mono text-zinc-500">
          {completedSubtasks.length}/{subtasks.length} hoàn thành ({percentComplete}%)
        </span>
      </div>

      {/* Progress bar */}
      {subtasks.length > 0 && (
        <div className="w-full h-1.5 bg-zinc-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-zinc-900 transition-all duration-300 rounded-full"
            style={{ width: `${percentComplete}%` }}
          />
        </div>
      )}

      {/* Subtask items */}
      <div className="space-y-1.5 pt-1">
        {subtasks.map((sub) => (
          <div
            key={sub.id}
            className="flex items-center justify-between p-2 rounded-lg bg-white border border-zinc-200 hover:border-zinc-300 transition group"
          >
            <label className="flex items-center gap-2.5 text-xs cursor-pointer flex-1">
              <input
                type="checkbox"
                checked={sub.isCompleted}
                onChange={() => onToggleSubtask(sub.id)}
                className="rounded border-zinc-300 text-zinc-900 focus:ring-0 cursor-pointer"
              />
              <span
                className={`text-zinc-800 transition ${
                  sub.isCompleted ? 'line-through text-zinc-400' : ''
                }`}
              >
                {sub.title}
              </span>
            </label>

            <button
              onClick={() => onDeleteSubtask(sub.id)}
              className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
              title="Xóa subtask"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Add Subtask Input */}
      <form onSubmit={handleAddSubtask} className="flex gap-2 pt-1.5">
        <input
          type="text"
          value={newSubtaskTitle}
          onChange={(e) => setNewSubtaskTitle(e.target.value)}
          placeholder="+ Thêm subtask mới (Nhấn Enter)..."
          className="flex-1 bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition"
        />
        <button
          type="submit"
          disabled={!newSubtaskTitle.trim()}
          className="px-3.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition flex items-center gap-1 shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          Thêm
        </button>
      </form>
    </div>
  );
}
