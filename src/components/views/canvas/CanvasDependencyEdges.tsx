import React, { useState } from 'react';
import { useWorkroomStore } from '../../../store/useWorkroomStore';
import {
  TASK_WIDTH,
  TASK_PORT_OFFSET_Y,
  createBezierPath,
  getBezierMidpoint,
  Point,
} from './canvasGeometry';
import { X } from 'lucide-react';
import type { TaskDependency } from '../../../types/workroom';

interface DraftConnection {
  sourceTaskId: string;
  mouseWorld: Point;
}

interface CanvasDependencyEdgesProps {
  draftConnection: DraftConnection | null;
}

export default function CanvasDependencyEdges({
  draftConnection,
}: CanvasDependencyEdgesProps) {
  const { tasks, dependencies, deleteDependency } = useWorkroomStore();
  const [hoveredDepId, setHoveredDepId] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent, dep: TaskDependency) => {
    e.stopPropagation();
    await deleteDependency(dep.id);
  };

  // Draft connection line coordinates
  let draftPath: string | null = null;
  if (draftConnection) {
    const src = tasks.find((t) => t.id === draftConnection.sourceTaskId);
    if (src) {
      const x1 = src.canvasX + TASK_WIDTH;
      const y1 = src.canvasY + TASK_PORT_OFFSET_Y;
      const x2 = draftConnection.mouseWorld.x;
      const y2 = draftConnection.mouseWorld.y;
      draftPath = createBezierPath(x1, y1, x2, y2);
    }
  }

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible z-0">
      <defs>
        {/* Emerald Arrow for Completed Prerequisites */}
        <marker
          id="arrow-emerald"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />
        </marker>

        {/* Amber Arrow for Blocking Prerequisites */}
        <marker
          id="arrow-amber"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
        </marker>

        {/* Indigo Arrow for Active Draft Dragging */}
        <marker
          id="arrow-indigo"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#818cf8" />
        </marker>
      </defs>

      {/* Render All Established Dependencies */}
      {dependencies.map((dep) => {
        const sourceTask = tasks.find((t) => t.id === dep.sourceTaskId);
        const targetTask = tasks.find((t) => t.id === dep.targetTaskId);

        if (!sourceTask || !targetTask) return null;

        const x1 = sourceTask.canvasX + TASK_WIDTH;
        const y1 = sourceTask.canvasY + TASK_PORT_OFFSET_Y;
        const x2 = targetTask.canvasX;
        const y2 = targetTask.canvasY + TASK_PORT_OFFSET_Y;

        const pathD = createBezierPath(x1, y1, x2, y2);
        const midpoint = getBezierMidpoint(x1, y1, x2, y2);
        const isDone = sourceTask.status === 'done';
        const color = isDone ? '#10b981' : '#f59e0b';
        const isHovered = hoveredDepId === dep.id;

        return (
          <g
            key={dep.id}
            onMouseEnter={() => setHoveredDepId(dep.id)}
            onMouseLeave={() => setHoveredDepId(null)}
          >
            {/* Thick Invisible Hover Zone for Easy Interaction */}
            <path
              d={pathD}
              fill="none"
              stroke="transparent"
              strokeWidth="20"
              className="pointer-events-auto cursor-pointer"
            />

            {/* Visual Bezier Curve */}
            <path
              d={pathD}
              fill="none"
              stroke={color}
              strokeWidth={isHovered ? '2.5' : '1.75'}
              strokeDasharray={isDone ? undefined : '5 3.5'}
              markerEnd={`url(#${isDone ? 'arrow-emerald' : 'arrow-amber'})`}
              className="transition-all"
            />

            {/* Delete Button at Midpoint */}
            <foreignObject
              x={midpoint.x - 9}
              y={midpoint.y - 9}
              width="18"
              height="18"
              className="pointer-events-auto overflow-visible"
            >
              <button
                onClick={(e) => handleDelete(e, dep)}
                title={`Xóa liên kết: ${sourceTask.title} -> ${targetTask.title}`}
                className={`w-4.5 h-4.5 rounded-full border flex items-center justify-center transition shadow-xs cursor-pointer ${
                  isHovered
                    ? 'bg-red-600 border-red-600 text-white scale-110'
                    : 'bg-white border-zinc-300 text-zinc-500 hover:bg-red-600 hover:text-white hover:border-red-600'
                }`}
              >
                <X className="w-2.5 h-2.5 stroke-[2.5]" />
              </button>
            </foreignObject>
          </g>
        );
      })}

      {/* Render Active Draft Dragging Connection */}
      {draftPath && (
        <path
          d={draftPath}
          fill="none"
          stroke="#4f46e5"
          strokeWidth="2"
          strokeDasharray="5 3"
          markerEnd="url(#arrow-indigo)"
        />
      )}
    </svg>
  );
}
