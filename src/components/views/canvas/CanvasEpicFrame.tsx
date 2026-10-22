import React, { useState } from 'react';
import { useWorkroomStore } from '../../../store/useWorkroomStore';
import { Move, Edit2, Trash2 } from 'lucide-react';
import type { Epic } from '../../../types/workroom';

interface CanvasEpicFrameProps {
  epic: Epic;
  zoom: number;
  isDropTarget: boolean;
  onEditEpic: (epic: Epic) => void;
}

export default function CanvasEpicFrame({
  epic,
  zoom,
  isDropTarget,
  onEditEpic,
}: CanvasEpicFrameProps) {
  const { tasks, deleteEpic, updateEpic, batchUpdatePositions } = useWorkroomStore();
  const memberTasks = tasks.filter((t) => t.epicId === epic.id);

  // 1. Drag Epic Container (moves Epic + all member tasks simultaneously)
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.stopPropagation();

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startEpicX = epic.canvasX;
    const startEpicY = epic.canvasY;

    const initialTaskCoords = memberTasks.map((t) => ({
      id: t.id,
      startX: t.canvasX,
      startY: t.canvasY,
    }));

    let lastEpicX = startEpicX;
    let lastEpicY = startEpicY;
    let lastTaskPositions = initialTaskCoords.map((t) => ({
      id: t.id,
      canvasX: t.startX,
      canvasY: t.startY,
      epicId: epic.id,
    }));

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = (moveEvent.clientX - startClientX) / zoom;
      const dy = (moveEvent.clientY - startClientY) / zoom;

      lastEpicX = Math.round(startEpicX + dx);
      lastEpicY = Math.round(startEpicY + dy);

      lastTaskPositions = initialTaskCoords.map((t) => ({
        id: t.id,
        canvasX: Math.round(t.startX + dx),
        canvasY: Math.round(t.startY + dy),
        epicId: epic.id,
      }));

      batchUpdatePositions({
        epics: [{ id: epic.id, canvasX: lastEpicX, canvasY: lastEpicY }],
        tasks: lastTaskPositions,
      });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      batchUpdatePositions({
        epics: [{ id: epic.id, canvasX: lastEpicX, canvasY: lastEpicY }],
        tasks: lastTaskPositions,
      });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // 2. Resize Handle (bottom-right corner)
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startWidth = epic.canvasWidth;
    const startHeight = epic.canvasHeight;

    let finalWidth = startWidth;
    let finalHeight = startHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = (moveEvent.clientX - startClientX) / zoom;
      const dy = (moveEvent.clientY - startClientY) / zoom;

      finalWidth = Math.max(300, Math.round(startWidth + dx));
      finalHeight = Math.max(200, Math.round(startHeight + dy));

      batchUpdatePositions({
        epics: [
          {
            id: epic.id,
            canvasWidth: finalWidth,
            canvasHeight: finalHeight,
          },
        ],
      });
    };

    const onMouseUp = async () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      await updateEpic(epic.id, {
        canvasWidth: finalWidth,
        canvasHeight: finalHeight,
      });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleDelete = async () => {
    if (
      window.confirm(
        `Xóa Epic "${epic.title}"? Các task bên trong sẽ được giữ nguyên và chuyển thành Task độc lập.`
      )
    ) {
      await deleteEpic(epic.id);
    }
  };

  return (
    <div
      style={{
        transform: `translate(${epic.canvasX}px, ${epic.canvasY}px)`,
        width: epic.canvasWidth,
        height: epic.canvasHeight,
        borderColor: isDropTarget ? '#6366f1' : `${epic.color}50`,
        backgroundColor: `${epic.color}0A`, // ~4% ultra-light tint
      }}
      className={`absolute top-0 left-0 rounded-xl border transition-colors select-none group ${
        isDropTarget ? 'ring-2 ring-indigo-400/50 shadow-sm' : ''
      }`}
    >
      {/* FigJam-Style External Section Header (Floating on Top-Left) */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className="absolute -top-7 left-0 flex items-center gap-1.5 cursor-grab active:cursor-grabbing select-none py-0.5 px-1 rounded hover:bg-white/70 transition"
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: epic.color }}
        />
        <h3
          className="text-[12px] font-semibold tracking-tight"
          style={{ color: epic.color }}
        >
          {epic.title}
        </h3>
        <span
          className="text-[11px] font-mono opacity-60 ml-0.5"
          style={{ color: epic.color }}
        >
          {memberTasks.length}
        </span>

        {/* Hover Action Buttons */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 ml-1 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditEpic(epic);
            }}
            title="Sửa Epic"
            className="p-1 rounded text-zinc-400 hover:text-zinc-800 hover:bg-white transition cursor-pointer"
          >
            <Edit2 className="w-3 h-3" strokeWidth={1.75} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
            title="Xóa Epic"
            className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-white transition cursor-pointer"
          >
            <Trash2 className="w-3 h-3" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Frame Interior: Empty Placeholder */}
      {memberTasks.length === 0 && (
        <div className="absolute inset-4 flex items-center justify-center text-[11px] text-zinc-400 border border-dashed border-zinc-300/60 rounded-lg pointer-events-none">
          Thả task vào đây
        </div>
      )}

      {/* Resize Handle at Bottom-Right */}
      <div
        onMouseDown={handleResizeMouseDown}
        title="Kéo để thay đổi kích thước khung"
        className="absolute -bottom-1 -right-1 w-4 h-4 cursor-nwse-resize flex items-center justify-center text-zinc-300 hover:text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <svg viewBox="0 0 10 10" className="w-2 h-2 fill-current">
          <path d="M7 1 L10 1 L10 10 L1 10 L1 7 L7 7 Z" />
        </svg>
      </div>
    </div>
  );
}
