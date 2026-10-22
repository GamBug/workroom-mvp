import React from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  LayoutGrid,
  Plus,
  Layers,
  HelpCircle,
} from 'lucide-react';

interface CanvasToolbarProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onAutoLayout: () => void;
  onOpenCreateEpic: () => void;
  onOpenCreateTask: () => void;
}

export default function CanvasToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetView,
  onAutoLayout,
  onOpenCreateEpic,
  onOpenCreateTask,
}: CanvasToolbarProps) {
  return (
    <>
      {/* 1. Bottom Left: Zoom Controls */}
      <div className="absolute bottom-5 left-5 z-20 bg-white border border-zinc-200/90 shadow-xs rounded-lg p-1 text-[12px] flex items-center gap-0.5">
        <button
          onClick={onZoomOut}
          title="Thu nhỏ (Zoom Out)"
          className="p-1 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer"
        >
          <ZoomOut className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>

        <button
          onClick={onResetView}
          title="Đặt lại 100%"
          className="w-10 py-0.5 rounded text-center text-[11px] font-mono font-medium text-zinc-700 hover:bg-zinc-100 transition cursor-pointer"
        >
          {Math.round(zoom * 100)}%
        </button>

        <button
          onClick={onZoomIn}
          title="Phóng to (Zoom In)"
          className="p-1 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer"
        >
          <ZoomIn className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>

        <div className="h-3 w-[1px] bg-zinc-200 mx-0.5" />

        <button
          onClick={onResetView}
          title="Góc nhìn 100% & Căn giữa"
          className="p-1 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" strokeWidth={1.75} />
        </button>
      </div>

      {/* 2. Bottom Center: Creative Floating Dock */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 bg-white border border-zinc-200/90 shadow-sm rounded-lg p-1 flex items-center gap-1">
        <button
          onClick={onOpenCreateTask}
          title="Thêm Thẻ Task mới"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-zinc-900 hover:bg-zinc-800 text-white transition cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          <span>Thẻ Task</span>
        </button>

        <button
          onClick={onOpenCreateEpic}
          title="Thêm Khung Epic mới"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer"
        >
          <Layers className="w-3.5 h-3.5 text-zinc-500" strokeWidth={1.75} />
          <span>Khung Epic</span>
        </button>

        <div className="h-4 w-[1px] bg-zinc-200 mx-0.5" />

        <button
          onClick={onAutoLayout}
          title="Tự động sắp xếp dàn đều các khung Epic & Task độc lập"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition cursor-pointer"
        >
          <LayoutGrid className="w-3.5 h-3.5 text-zinc-500" strokeWidth={1.75} />
          <span>Sắp xếp gọn</span>
        </button>
      </div>

      {/* 3. Bottom Right: Help Tooltip */}
      <div className="absolute bottom-5 right-5 z-20 group/help">
        <button
          className="w-7 h-7 rounded-lg bg-white border border-zinc-200/90 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-50 flex items-center justify-center transition shadow-xs cursor-help"
          title="Hướng dẫn Canvas"
        >
          <HelpCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
        <div className="absolute right-0 bottom-full mb-2 w-64 p-3 rounded-lg bg-white border border-zinc-200 shadow-xl text-xs text-zinc-600 space-y-1.5 opacity-0 group-hover/help:opacity-100 pointer-events-none transition-opacity z-30">
          <div className="font-medium text-zinc-900 text-[12px]">Thao tác trên Canvas:</div>
          <div className="space-y-1 text-[11px] leading-relaxed text-zinc-500">
            <p>• <strong>Di chuyển:</strong> Kéo chuột trên nền hoặc giữ Space.</p>
            <p>• <strong>Gán nhóm:</strong> Kéo task vào khung Epic.</p>
            <p>• <strong>Nối dây:</strong> Hover thẻ task, kéo từ điểm tròn bên phải sang task khác.</p>
          </div>
        </div>
      </div>
    </>
  );
}
