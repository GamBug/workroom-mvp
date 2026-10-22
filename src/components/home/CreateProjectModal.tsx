import React, { useState } from 'react';
import { useWorkroomStore } from '../../store/useWorkroomStore';
import { Plus, X, Sparkles } from 'lucide-react';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateProjectModal({ isOpen, onClose }: CreateProjectModalProps) {
  const { currentUser, createProject, fetchProjectFullData } = useWorkroomStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !currentUser) return;

    try {
      setIsSubmitting(true);
      setError(null);
      const created = await createProject({
        name: name.trim(),
        description: description.trim(),
        ownerId: currentUser.id,
      });
      setName('');
      setDescription('');
      onClose();
      // Open the newly created project
      await fetchProjectFullData(created.id);
    } catch (err: any) {
      setError(err.message || 'Không thể tạo dự án');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
      <div className="bg-white border border-zinc-200 rounded-2xl w-full max-w-md p-6 shadow-xl relative text-zinc-900">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-100">
          <h3 className="text-base font-bold text-zinc-900 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-zinc-900" />
            Tạo Project Mới
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Tên Project <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="VD: Cải tiến sản phẩm Q4..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 transition"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Mô tả ngắn (Optional)
            </label>
            <textarea
              rows={3}
              placeholder="Mục tiêu chính và phạm vi của dự án..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 transition resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              {isSubmitting ? (
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  Tạo & Mở Project
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
