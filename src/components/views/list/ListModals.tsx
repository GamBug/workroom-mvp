import React from 'react';
import { Layers, Plus, X, Check } from 'lucide-react';
import { EPIC_COLORS } from './listConstants';
import type { Epic, TaskPriority } from '../../../types/workroom';

interface ListEpicModalProps {
  isOpen: boolean;
  editingEpicId: string | null;
  epicTitle: string;
  epicColor: string;
  onEpicTitleChange: (val: string) => void;
  onEpicColorChange: (val: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function ListEpicModal({
  isOpen,
  editingEpicId,
  epicTitle,
  epicColor,
  onEpicTitleChange,
  onEpicColorChange,
  onClose,
  onSubmit,
}: ListEpicModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
      <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-sm p-6 shadow-xl relative">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-100">
          <h3 className="text-base font-semibold text-zinc-900 flex items-center gap-2">
            <Layers className="w-4 h-4 text-zinc-700" />
            {editingEpicId ? 'Sửa Epic' : 'Tạo Epic Mới'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Tên Epic <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="VD: Giai đoạn 1: Thiết kế..."
              value={epicTitle}
              onChange={(e) => onEpicTitleChange(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:bg-white focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 transition"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-2">Màu sắc đại diện</label>
            <div className="flex items-center gap-2 flex-wrap">
              {EPIC_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onEpicColorChange(c)}
                  className="w-7 h-7 rounded-full flex items-center justify-center transition transform hover:scale-110 shadow-xs"
                  style={{ backgroundColor: c }}
                >
                  {epicColor === c && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={!epicTitle.trim()}
              className="px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition shadow-xs"
            >
              {editingEpicId ? 'Cập nhật' : 'Tạo Epic'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ListTaskModalProps {
  isOpen: boolean;
  newTaskTitle: string;
  newTaskPriority: TaskPriority;
  taskTargetEpicId: string | null;
  epics: Epic[];
  onTitleChange: (val: string) => void;
  onPriorityChange: (val: TaskPriority) => void;
  onEpicIdChange: (val: string | null) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function ListTaskModal({
  isOpen,
  newTaskTitle,
  newTaskPriority,
  taskTargetEpicId,
  epics,
  onTitleChange,
  onPriorityChange,
  onEpicIdChange,
  onClose,
  onSubmit,
}: ListTaskModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
      <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-md p-6 shadow-xl relative">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-100">
          <h3 className="text-base font-semibold text-zinc-900 flex items-center gap-2">
            <Plus className="w-4 h-4 text-zinc-700" />
            Tạo Task Mới
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Tiêu đề Task <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="VD: Viết test cho authentication..."
              value={newTaskTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:bg-white focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 transition"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Gán vào Epic</label>
              <select
                value={taskTargetEpicId || ''}
                onChange={(e) => onEpicIdChange(e.target.value === '' ? null : e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 text-xs text-zinc-900 focus:bg-white focus:outline-none focus:border-zinc-400 transition"
              >
                <option value="">Không thuộc Epic (Tự do)</option>
                {epics.map((epic) => (
                  <option key={epic.id} value={epic.id}>
                    {epic.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Độ ưu tiên</label>
              <select
                value={newTaskPriority}
                onChange={(e) => onPriorityChange(e.target.value as TaskPriority)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 text-xs text-zinc-900 focus:bg-white focus:outline-none focus:border-zinc-400 transition"
              >
                <option value="low">Thấp (Low)</option>
                <option value="medium">Trung bình (Medium)</option>
                <option value="high">Cao (High)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={!newTaskTitle.trim()}
              className="px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition shadow-xs"
            >
              Tạo Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
