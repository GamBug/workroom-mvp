import React, { useState } from 'react';
import { useWorkroomStore } from '../../../store/useWorkroomStore';
import { Layers, X } from 'lucide-react';
import type { Epic } from '../../../types/workroom';

interface CanvasQuickEpicModalProps {
  isOpen: boolean;
  spawnPosition: { x: number; y: number };
  epicToEdit?: Epic | null;
  onClose: () => void;
}

const EPIC_PALETTE = [
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#8b5cf6', // Purple
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#f43f5e', // Rose
  '#64748b', // Slate
];

export default function CanvasQuickEpicModal({
  isOpen,
  spawnPosition,
  epicToEdit,
  onClose,
}: CanvasQuickEpicModalProps) {
  const { currentProject, createEpic, updateEpic } = useWorkroomStore();
  const [title, setTitle] = useState(epicToEdit?.title || '');
  const [color, setColor] = useState(epicToEdit?.color || '#3b82f6');
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    if (epicToEdit) {
      setTitle(epicToEdit.title);
      setColor(epicToEdit.color);
    } else {
      setTitle('');
      setColor('#3b82f6');
    }
  }, [epicToEdit, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !currentProject) return;

    try {
      setIsSubmitting(true);
      if (epicToEdit) {
        await updateEpic(epicToEdit.id, {
          title: title.trim(),
          color,
        });
      } else {
        await createEpic({
          projectId: currentProject.id,
          title: title.trim(),
          color,
          canvasX: Math.round(spawnPosition.x),
          canvasY: Math.round(spawnPosition.y),
          canvasWidth: 540,
          canvasHeight: 360,
        });
      }
      onClose();
    } catch (err) {
      console.error('Failed to save epic:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
      <div className="w-full max-w-sm rounded-2xl bg-white border border-zinc-200 p-6 shadow-xl text-zinc-900 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-zinc-900" />
            <h3 className="text-sm font-bold text-zinc-900">
              {epicToEdit ? 'Chỉnh sửa Khung Epic' : 'Tạo Khung Epic Mới'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Tên Epic *
            </label>
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Core Engine, UI Redesign..."
              className="w-full px-3 py-2 rounded-lg bg-white border border-zinc-200 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-2">
              Màu sắc nhận diện
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {EPIC_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-transform border border-black/10 cursor-pointer ${
                    color === c ? 'scale-125 ring-2 ring-zinc-900' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-white shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? 'Đang lưu...' : epicToEdit ? 'Lưu thay đổi' : 'Tạo Khung Epic'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
