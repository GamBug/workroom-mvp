import React, { useState } from 'react';
import type { Epic, TaskPriority, TaskStatus } from '../../../types/workroom';
import { Plus, X } from 'lucide-react';

interface QuickTaskModalProps {
  isOpen: boolean;
  initialStatus: TaskStatus;
  initialEpicId: string | null;
  epics: Epic[];
  onClose: () => void;
  onSubmit: (title: string, status: TaskStatus, priority: TaskPriority, epicId: string | null) => Promise<void>;
}

export default function QuickTaskModal({
  isOpen,
  initialStatus,
  initialEpicId,
  epics,
  onClose,
  onSubmit,
}: QuickTaskModalProps) {
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<TaskStatus>(initialStatus);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [epicId, setEpicId] = useState<string | null>(initialEpicId);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      setIsSubmitting(true);
      await onSubmit(title.trim(), status, priority, epicId);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
      <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-md p-6 shadow-xl relative">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-100">
          <h3 className="text-base font-semibold text-zinc-900 flex items-center gap-2">
            <Plus className="w-4 h-4 text-zinc-700" />
            Thêm Task trên Kanban
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1.5">
              Tiêu đề Task <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="Nhập tiêu đề công việc..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:bg-white focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 transition"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Cột (Status)</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs text-zinc-900 focus:bg-white focus:outline-none focus:border-zinc-400 transition"
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">In Review</option>
                <option value="done">Done</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Độ ưu tiên</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs text-zinc-900 focus:bg-white focus:outline-none focus:border-zinc-400 transition"
              >
                <option value="low">Thấp</option>
                <option value="medium">Vừa</option>
                <option value="high">Cao</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Epic</label>
              <select
                value={epicId || ''}
                onChange={(e) => setEpicId(e.target.value === '' ? null : e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1.5 text-xs text-zinc-900 focus:bg-white focus:outline-none focus:border-zinc-400 truncate transition"
              >
                <option value="">Không Epic</option>
                {epics.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.title}
                  </option>
                ))}
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
              disabled={isSubmitting || !title.trim()}
              className="px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition shadow-xs"
            >
              {isSubmitting ? 'Đang tạo...' : 'Tạo Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
