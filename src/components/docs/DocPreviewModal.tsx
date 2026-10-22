import React from 'react';
import { useWorkroomStore } from '../../store/useWorkroomStore';
import {
  FileText,
  Link as LinkIcon,
  StickyNote,
  ExternalLink,
  X,
  Edit2,
  Calendar,
  User as UserIcon,
  CheckSquare,
  ArrowRight,
} from 'lucide-react';
import { extractMentionedDocIds } from '../../utils/docMentions';
import type { ProjectDoc } from '../../types/workroom';

interface DocPreviewModalProps {
  onEditDoc?: (doc: ProjectDoc) => void;
}

export default function DocPreviewModal({ onEditDoc }: DocPreviewModalProps) {
  const {
    docs,
    tasks,
    users,
    activePreviewDocId,
    setActivePreviewDocId,
    setSelectedTaskId,
  } = useWorkroomStore();

  const doc = docs.find((d) => d.id === activePreviewDocId);

  if (!doc) return null;

  const updater = users.find((u) => u.id === doc.updatedBy);
  const formattedDate = new Date(doc.updatedAt).toLocaleDateString('vi-VN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Find all tasks that mention this doc
  const referringTasks = tasks.filter((t) =>
    extractMentionedDocIds(t.description).includes(doc.id)
  );

  const docIcon = {
    markdown: <FileText className="w-5 h-5 text-rose-400" />,
    link: <LinkIcon className="w-5 h-5 text-sky-400" />,
    note: <StickyNote className="w-5 h-5 text-amber-400" />,
  }[doc.docType];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
      <div className="bg-white border border-zinc-200 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden relative">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between gap-4 bg-white flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="p-2 rounded-lg bg-zinc-50 border border-zinc-200">
              {docIcon}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-600 border border-zinc-200">
                  {doc.category}
                </span>
                <span className="text-[11px] text-zinc-400 font-mono">
                  {doc.docType}
                </span>
              </div>
              <h3 className="text-base font-semibold text-zinc-900 truncate mt-0.5">{doc.title}</h3>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {onEditDoc && (
              <button
                onClick={() => {
                  onEditDoc(doc);
                  setActivePreviewDocId(null);
                }}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition"
                title="Chỉnh sửa tài liệu"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => setActivePreviewDocId(null)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition"
              title="Đóng (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Doc metadata */}
          <div className="flex items-center gap-4 text-xs text-zinc-500 pb-2 border-b border-zinc-100">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-zinc-400" />
              <span>Cập nhật: {formattedDate}</span>
            </div>
            {updater && (
              <div className="flex items-center gap-1.5">
                <UserIcon className="w-3.5 h-3.5 text-zinc-400" />
                <span>Bởi: {updater.displayName}</span>
              </div>
            )}
          </div>

          {/* Doc view based on docType */}
          {doc.docType === 'link' ? (
            <div className="p-6 rounded-xl bg-zinc-50 border border-zinc-200 text-center space-y-4">
              <div className="w-12 h-12 rounded-xl bg-white border border-zinc-200 text-zinc-700 flex items-center justify-center mx-auto shadow-xs">
                <LinkIcon className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-zinc-900">Liên kết tài nguyên bên ngoài</h4>
                <p className="text-xs text-zinc-600 font-mono mt-1 break-all bg-white p-2.5 rounded-lg border border-zinc-200">
                  {doc.content}
                </p>
              </div>
              <a
                href={doc.content}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-xs font-medium transition shadow-xs"
              >
                <span>Mở trong Tab Mới</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200">
              <pre className="text-xs text-zinc-800 font-sans whitespace-pre-wrap leading-relaxed">
                {doc.content || '(Tài liệu chưa có nội dung)'}
              </pre>
            </div>
          )}

          {/* Backlinks: Tasks referring to this doc */}
          <div className="pt-2 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-zinc-600 flex items-center gap-1.5">
                <CheckSquare className="w-3.5 h-3.5 text-zinc-500" />
                Được gắn thẻ trong các Tasks ({referringTasks.length})
              </h4>
            </div>

            {referringTasks.length === 0 ? (
              <p className="text-xs text-zinc-400 italic">
                Chưa có task nào gắn thẻ tài liệu này. Gõ <code className="text-zinc-800 font-semibold bg-zinc-100 px-1 py-0.5 rounded">@{doc.title}</code> trong mô tả task để liên kết.
              </p>
            ) : (
              <div className="space-y-1.5">
                {referringTasks.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => {
                      setSelectedTaskId(t.id);
                    }}
                    className="p-2.5 rounded-lg bg-white border border-zinc-200 hover:border-zinc-300 flex items-center justify-between text-xs cursor-pointer group transition shadow-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-800 group-hover:text-zinc-900 transition">
                        {t.title}
                      </span>
                      <span className="text-[11px] text-zinc-500 font-normal">
                        {t.status === 'done' ? 'Done' : t.status === 'in_progress' ? 'In Progress' : t.status === 'review' ? 'Review' : 'Todo'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-zinc-400 group-hover:text-zinc-700 transition text-[11px]">
                      <span>Xem task</span>
                      <ArrowRight className="w-3 h-3" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-100 bg-zinc-50 flex items-center justify-end">
          <button
            onClick={() => setActivePreviewDocId(null)}
            className="px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-xs font-medium transition shadow-xs"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
