import React, { useState } from 'react';
import { useWorkroomStore } from '../../../store/useWorkroomStore';
import { Plus, X } from 'lucide-react';
import { findContainingEpic } from './canvasGeometry';
import type { TaskPriority, TaskStatus, Epic } from '../../../types/workroom';

interface CanvasQuickTaskModalProps {
  isOpen: boolean;
  spawnPosition: { x: number; y: number };
  epics: Epic[];
  onClose: () => void;
}

export default function CanvasQuickTaskModal({
  isOpen,
  spawnPosition,
  epics,
  onClose,
}: CanvasQuickTaskModalProps) {
  const { currentProject, createTask } = useWorkroomStore();
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-detect if spawnPosition is inside an Epic
  const initialContainingEpic = findContainingEpic(spawnPosition.x, spawnPosition.y, epics);
  const [epicId, setEpicId] = useState<string | null>(initialContainingEpic?.id || null);

  React.useEffect(() => {
    if (isOpen) {
      setTitle('');
      setStatus('todo');
      setPriority('medium');
      const detected = findContainingEpic(spawnPosition.x, spawnPosition.y, epics);
      setEpicId(detected?.id || null);
    }
  }, [isOpen, spawnPosition, epics]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !currentProject) return;

    try {
      setIsSubmitting(true);
      await createTask({
        projectId: currentProject.id,
        title: title.trim(),
        status,
        priority,
        epicId,
        canvasX: Math.round(spawnPosition.x),
        canvasY: Math.round(spawnPosition.y),
      });
      onClose();
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
      <div className="w-full max-w-md rounded-xl bg-white border border-zinc-200 p-6 shadow-xl text-zinc-900 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-zinc-700" />
            <h3 className="text-base font-semibold text-zinc-900">Thêm Thẻ Task Mới</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Tiêu đề Task *
            </label>
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Viết test cho Canvas, Thiết kế UI..."
              className="w-full px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 text-sm text-zinc-900 placeholder-zinc-400 focus:bg-white focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Trạng thái
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 text-xs text-zinc-900 focus:bg-white focus:outline-none focus:border-zinc-400 transition"
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">In Review</option>
                <option value="done">Done</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Độ ưu tiên
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 text-xs text-zinc-900 focus:bg-white focus:outline-none focus:border-zinc-400 transition"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Gán vào Epic (Tùy chọn)
            </label>
            <select
              value={epicId || ''}
              onChange={(e) => setEpicId(e.target.value || null)}
              className="w-full px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 text-xs text-zinc-900 focus:bg-white focus:outline-none focus:border-zinc-400 transition"
            >
              <option value="">Không gán (Task độc lập)</option>
              {epics.map((epic) => (
                <option key={epic.id} value={epic.id}>
                  {epic.title}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-white shadow-xs transition disabled:opacity-50"
            >
              {isSubmitting ? 'Đang tạo...' : 'Tạo Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
