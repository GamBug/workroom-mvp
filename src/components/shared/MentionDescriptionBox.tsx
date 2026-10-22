import React, { useState, useRef, useEffect } from 'react';
import { useWorkroomStore } from '../../store/useWorkroomStore';
import { extractMentionedDocs, type MentionedDoc } from '../../utils/docMentions';
import {
  FileText,
  Link as LinkIcon,
  StickyNote,
  AtSign,
  ExternalLink,
  BookOpen,
} from 'lucide-react';

interface MentionDescriptionBoxProps {
  value: string;
  onChange: (val: string) => void;
  onBlur?: () => void;
  placeholder?: string;
}

export default function MentionDescriptionBox({
  value,
  onChange,
  onBlur,
  placeholder = 'Mô tả công việc... Gõ @ để gắn thẻ tài liệu...',
}: MentionDescriptionBoxProps) {
  const { docs, setActivePreviewDocId } = useWorkroomStore();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [atIndex, setAtIndex] = useState<number | null>(null);

  // Extract all docs mentioned in current value
  const mentionedDocs: MentionedDoc[] = extractMentionedDocs(value);

  // Filter docs matching mentionQuery
  const filteredDocs = docs.filter((d) =>
    d.title.toLowerCase().includes(mentionQuery.toLowerCase()) ||
    (d.category && d.category.toLowerCase().includes(mentionQuery.toLowerCase()))
  );

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    onChange(newVal);

    // Check if cursor is right after an '@'
    const textBefore = newVal.slice(0, cursorPos);
    const lastAtPos = textBefore.lastIndexOf('@');

    if (lastAtPos !== -1) {
      const queryPart = textBefore.slice(lastAtPos + 1);
      // Valid if queryPart contains no spaces or newlines
      if (!/\s/.test(queryPart)) {
        setAtIndex(lastAtPos);
        setMentionQuery(queryPart);
        setShowDropdown(true);
        return;
      }
    }

    setShowDropdown(false);
    setAtIndex(null);
  };

  const insertMention = (docTitle: string, docId: string) => {
    const mentionTag = `@[${docTitle}](doc:${docId}) `;
    const textarea = textareaRef.current;
    const currentVal = value;

    let newVal: string;
    let newCursorPos: number;

    if (atIndex !== null && atIndex >= 0) {
      // Replace @query with mentionTag
      const beforeAt = currentVal.slice(0, atIndex);
      const afterCursor = currentVal.slice(textarea?.selectionStart || (atIndex + mentionQuery.length + 1));
      newVal = beforeAt + mentionTag + afterCursor;
      newCursorPos = beforeAt.length + mentionTag.length;
    } else {
      // Append at current cursor or end
      const cursor = textarea?.selectionStart || currentVal.length;
      newVal = currentVal.slice(0, cursor) + mentionTag + currentVal.slice(cursor);
      newCursorPos = cursor + mentionTag.length;
    }

    onChange(newVal);
    setShowDropdown(false);
    setAtIndex(null);

    // Re-focus and update cursor
    setTimeout(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 10);
  };

  const getDocIcon = (type: string) => {
    switch (type) {
      case 'link':
        return <LinkIcon className="w-3.5 h-3.5 text-sky-400" />;
      case 'note':
        return <StickyNote className="w-3.5 h-3.5 text-amber-400" />;
      default:
        return <FileText className="w-3.5 h-3.5 text-rose-400" />;
    }
  };

  return (
    <div className="space-y-2 relative">
      {/* Description Header Row with Attach Button */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-zinc-700">
          Mô tả chi tiết
        </label>

        <button
          type="button"
          onClick={() => {
            setAtIndex(textareaRef.current?.selectionStart || value.length);
            setMentionQuery('');
            setShowDropdown(true);
            textareaRef.current?.focus();
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white hover:bg-zinc-50 text-zinc-700 border border-zinc-200 text-[11px] font-medium transition shadow-xs"
          title="Đính kèm tài liệu vào mô tả"
        >
          <AtSign className="w-3 h-3 text-zinc-500" />
          <span>Đính kèm tài liệu</span>
        </button>
      </div>

      {/* Textarea container */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          rows={4}
          value={value}
          onChange={handleTextChange}
          onBlur={() => {
            // Delay closing to allow clicking dropdown items
            setTimeout(() => setShowDropdown(false), 200);
            if (onBlur) onBlur();
          }}
          placeholder={placeholder}
          className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-3 text-xs text-zinc-900 placeholder-zinc-400 focus:bg-white focus:outline-none focus:border-zinc-400 resize-none transition font-sans leading-relaxed"
        />

        {/* Floating Autocomplete Dropdown */}
        {showDropdown && (
          <div className="absolute left-2 bottom-full mb-2 w-72 max-h-56 overflow-y-auto bg-white border border-zinc-200 rounded-xl shadow-xl p-1.5 z-50 animate-fade-in">
            <div className="px-2 py-1 text-[11px] font-medium text-zinc-500 border-b border-zinc-100 flex items-center justify-between">
              <span>Gợi ý tài liệu</span>
              <span className="text-zinc-600 font-mono">@{mentionQuery}</span>
            </div>

            {filteredDocs.length === 0 ? (
              <div className="p-3 text-center text-[11px] text-zinc-400">
                Không tìm thấy tài liệu phù hợp.
              </div>
            ) : (
              <div className="py-1 space-y-0.5">
                {filteredDocs.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault(); // Prevent textarea blur
                      insertMention(doc.title, doc.id);
                    }}
                    className="w-full p-2 rounded-lg text-left hover:bg-zinc-50 flex items-center gap-2.5 transition text-xs group"
                  >
                    <span className="p-1 rounded-md bg-zinc-100 border border-zinc-200 flex-shrink-0">
                      {getDocIcon(doc.docType)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-zinc-800 font-medium group-hover:text-zinc-900 truncate">
                        {doc.title}
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate">
                        {doc.category || 'General'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Interactive Doc Chips */}
      {mentionedDocs.length > 0 && (
        <div className="pt-1 space-y-1.5">
          <div className="text-[11px] font-medium text-zinc-500 flex items-center gap-1">
            <BookOpen className="w-3 h-3 text-zinc-500" />
            <span>Tài liệu đính kèm ({mentionedDocs.length}):</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {mentionedDocs.map(({ title, docId }) => {
              const matchedDoc = docs.find((d) => d.id === docId);
              return (
                <button
                  key={docId}
                  type="button"
                  onClick={() => setActivePreviewDocId(docId)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200/80 border border-zinc-200 text-zinc-800 text-xs font-medium transition group shadow-xs"
                  title="Bấm để xem nhanh nội dung tài liệu"
                >
                  <FileText className="w-3 h-3 text-zinc-500" />
                  <span className="truncate max-w-[160px]">{matchedDoc?.title || title}</span>
                  <ExternalLink className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 text-zinc-500" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
