import React, { useState, useEffect } from 'react';
import { useWorkroomStore } from '../../store/useWorkroomStore';
import type { DocType, ProjectDoc } from '../../types/workroom';
import { FileText, Link as LinkIcon, StickyNote, X, Plus } from 'lucide-react';

interface DocFormModalProps {
  isOpen: boolean;
  docToEdit?: ProjectDoc | null;
  onClose: () => void;
}

const CATEGORY_SUGGESTIONS = [
  'General',
  'Architecture',
  'Design',
  'Guidelines',
  'API & Specs',
  'Meeting Notes',
];

export default function DocFormModal({ isOpen, docToEdit, onClose }: DocFormModalProps) {
  const { currentProject, currentUser, createDoc, updateDoc } = useWorkroomStore();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('General');
  const [docType, setDocType] = useState<DocType>('markdown');
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (docToEdit) {
      setTitle(docToEdit.title);
      setCategory(docToEdit.category || 'General');
      setDocType(docToEdit.docType);
      setContent(docToEdit.content || '');
    } else {
      setTitle('');
      setCategory('General');
      setDocType('markdown');
      setContent('');
    }
  }, [docToEdit, isOpen]);

  if (!isOpen || !currentProject) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      setIsSubmitting(true);
      if (docToEdit) {
        await updateDoc(docToEdit.id, {
          title: title.trim(),
          category: category.trim() || 'General',
          docType,
          content,
          updatedBy: currentUser?.id || null,
        });
      } else {
        await createDoc({
          projectId: currentProject.id,
          title: title.trim(),
          category: category.trim() || 'General',
          docType,
          content,
          updatedBy: currentUser?.id || null,
        });
      }
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
      <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-lg p-6 shadow-xl relative">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100 mb-4">
          <h3 className="text-base font-semibold text-zinc-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-zinc-700" />
            {docToEdit ? 'Chỉnh sửa Tài Liệu' : 'Thêm Tài Liệu Mới'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Tiêu đề Tài liệu <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="VD: Tài liệu Kiến trúc Hệ thống..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:bg-white focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 transition"
              autoFocus
            />
          </div>

          {/* Category & DocType */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Danh mục (Category)</label>
              <input
                type="text"
                list="category-options"
                placeholder="VD: Architecture"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:bg-white focus:outline-none focus:border-zinc-400 transition"
              />
              <datalist id="category-options">
                {CATEGORY_SUGGESTIONS.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Loại tài liệu</label>
              <div className="grid grid-cols-3 gap-1 p-0.5 bg-zinc-100 rounded-lg border border-zinc-200/80">
                <button
                  type="button"
                  onClick={() => setDocType('markdown')}
                  className={`py-1 text-[11px] rounded-md transition flex items-center justify-center gap-1 ${
                    docType === 'markdown'
                      ? 'bg-white text-zinc-900 font-semibold shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-800 font-medium'
                  }`}
                >
                  <FileText className="w-3 h-3" />
                  Doc
                </button>
                <button
                  type="button"
                  onClick={() => setDocType('link')}
                  className={`py-1 text-[11px] rounded-md transition flex items-center justify-center gap-1 ${
                    docType === 'link'
                      ? 'bg-white text-zinc-900 font-semibold shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-800 font-medium'
                  }`}
                >
                  <LinkIcon className="w-3 h-3" />
                  Link
                </button>
                <button
                  type="button"
                  onClick={() => setDocType('note')}
                  className={`py-1 text-[11px] rounded-md transition flex items-center justify-center gap-1 ${
                    docType === 'note'
                      ? 'bg-white text-zinc-900 font-semibold shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-800 font-medium'
                  }`}
                >
                  <StickyNote className="w-3 h-3" />
                  Note
                </button>
              </div>
            </div>
          </div>

          {/* Content / URL input */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              {docType === 'link' ? 'Đường dẫn liên kết (URL)' : 'Nội dung tài liệu'}
            </label>
            {docType === 'link' ? (
              <input
                type="url"
                required
                placeholder="https://figma.com/... hoặc https://..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-900 placeholder-zinc-400 focus:bg-white focus:outline-none focus:border-zinc-400 font-mono transition"
              />
            ) : (
              <textarea
                rows={7}
                placeholder="Nhập nội dung markdown hoặc ghi chú..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-xs text-zinc-900 placeholder-zinc-400 focus:bg-white focus:outline-none focus:border-zinc-400 resize-none font-mono transition"
              />
            )}
          </div>

          {/* Submit */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">
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
              className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition shadow-xs flex items-center gap-1.5"
            >
              {docToEdit ? 'Lưu thay đổi' : 'Tạo Tài Liệu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
