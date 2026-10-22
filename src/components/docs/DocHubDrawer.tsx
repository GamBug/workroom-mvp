import React, { useState } from 'react';
import { useWorkroomStore } from '../../store/useWorkroomStore';
import {
  BookOpen,
  FileText,
  Link as LinkIcon,
  StickyNote,
  Plus,
  Search,
  X,
  Edit2,
  Trash2,
  CheckSquare,
} from 'lucide-react';
import { extractMentionedDocIds } from '../../utils/docMentions';
import type { ProjectDoc } from '../../types/workroom';

interface DocHubDrawerProps {
  onOpenCreateDoc: () => void;
  onEditDoc: (doc: ProjectDoc) => void;
}

export default function DocHubDrawer({ onOpenCreateDoc, onEditDoc }: DocHubDrawerProps) {
  const {
    docs,
    tasks,
    isDocHubOpen,
    setIsDocHubOpen,
    setActivePreviewDocId,
    deleteDoc,
  } = useWorkroomStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  if (!isDocHubOpen) return null;

  // Extract all categories
  const categories = Array.from(new Set(docs.map((d) => d.category || 'General')));

  // Filter docs
  const filteredDocs = docs.filter((doc) => {
    const matchesSearch =
      doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (doc.content && doc.content.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory =
      selectedCategory === 'all' || (doc.category || 'General') === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleDelete = async (e: React.MouseEvent, doc: ProjectDoc) => {
    e.stopPropagation();
    if (window.confirm(`Xóa tài liệu "${doc.title}" khỏi dự án?`)) {
      await deleteDoc(doc.id);
    }
  };

  const getDocTypeIcon = (type: string) => {
    switch (type) {
      case 'link':
        return <LinkIcon className="w-4 h-4 text-sky-400" />;
      case 'note':
        return <StickyNote className="w-4 h-4 text-amber-400" />;
      default:
        return <FileText className="w-4 h-4 text-rose-400" />;
    }
  };

  return (
    <aside className="w-80 md:w-96 border-l border-zinc-200 bg-white flex flex-col h-full z-30 shadow-xl animate-slide-left">
      {/* Header */}
      <div className="p-4 border-b border-zinc-100 flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-zinc-700" />
          <h3 className="text-sm font-semibold text-zinc-900">Kho tài liệu chung</h3>
          <span className="text-[10px] px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-600 border border-zinc-200 font-mono">
            {docs.length}
          </span>
        </div>
        <button
          onClick={() => setIsDocHubOpen(false)}
          className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Toolbar: Search, Category Filter, Add Button */}
      <div className="p-4 border-b border-zinc-100 space-y-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Tìm kiếm tài liệu..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:bg-white focus:outline-none focus:border-zinc-400 transition"
            />
          </div>

          <button
            onClick={onOpenCreateDoc}
            className="p-1.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-xs font-medium transition shadow-xs flex-shrink-0"
            title="Thêm tài liệu mới"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition ${
              selectedCategory === 'all'
                ? 'bg-zinc-900 text-white shadow-xs'
                : 'bg-zinc-100 text-zinc-600 hover:text-zinc-900 border border-zinc-200/80'
            }`}
          >
            Tất cả
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition ${
                selectedCategory === cat
                  ? 'bg-zinc-900 text-white shadow-xs'
                  : 'bg-zinc-100 text-zinc-600 hover:text-zinc-900 border border-zinc-200/80'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Docs List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredDocs.length === 0 ? (
          <div className="py-12 text-center text-xs text-zinc-400 space-y-2">
            <p>Không tìm thấy tài liệu phù hợp.</p>
            <button
              onClick={onOpenCreateDoc}
              className="text-zinc-900 font-medium hover:underline inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Tạo tài liệu ngay
            </button>
          </div>
        ) : (
          filteredDocs.map((doc) => {
            // Count tasks mentioning this doc
            const taggedTaskCount = tasks.filter((t) =>
              extractMentionedDocIds(t.description).includes(doc.id)
            ).length;

            return (
              <div
                key={doc.id}
                onClick={() => setActivePreviewDocId(doc.id)}
                className="p-3.5 rounded-xl bg-white border border-zinc-200 hover:border-zinc-300 transition cursor-pointer space-y-2 group shadow-xs hover:shadow-sm"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="p-1 rounded-md bg-zinc-50 border border-zinc-200 flex-shrink-0">
                      {getDocTypeIcon(doc.docType)}
                    </span>
                    <h4 className="text-xs font-semibold text-zinc-900 group-hover:text-zinc-700 transition truncate">
                      {doc.title}
                    </h4>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditDoc(doc);
                      }}
                      className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition"
                      title="Sửa"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleDelete(e, doc)}
                      className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 transition"
                      title="Xóa"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Excerpt */}
                <p className="text-[11px] text-zinc-600 line-clamp-2 leading-relaxed bg-zinc-50 p-2 rounded-lg border border-zinc-100 font-mono">
                  {doc.content || '(Tài liệu trống)'}
                </p>

                {/* Footer metadata */}
                <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-1 border-t border-zinc-100">
                  <span className="px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-600 font-medium">
                    {doc.category || 'General'}
                  </span>

                  {taggedTaskCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-zinc-700 font-medium">
                      <CheckSquare className="w-3 h-3 text-zinc-500" />
                      Gắn trong {taggedTaskCount} task
                    </span>
                  ) : (
                    <span className="text-zinc-400">Chưa gắn task nào</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
