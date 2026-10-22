import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useWorkroomStore } from '../../store/useWorkroomStore';
import CanvasToolbar from './canvas/CanvasToolbar';
import CanvasEpicFrame from './canvas/CanvasEpicFrame';
import CanvasTaskNode from './canvas/CanvasTaskNode';
import CanvasDependencyEdges from './canvas/CanvasDependencyEdges';
import CanvasQuickEpicModal from './canvas/CanvasQuickEpicModal';
import CanvasQuickTaskModal from './canvas/CanvasQuickTaskModal';
import { calculateAutoLayout, Point } from './canvas/canvasGeometry';
import type { Epic } from '../../types/workroom';

export default function CanvasView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    currentProject,
    epics,
    tasks,
    batchUpdatePositions,
    createDependency,
  } = useWorkroomStore();

  // Viewport Pan & Zoom state
  const [pan, setPan] = useState<Point>({ x: 20, y: 20 });
  const [zoom, setZoom] = useState(1.0);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });

  // Epic drop target highlighting
  const [hoveringEpicId, setHoveringEpicId] = useState<string | null>(null);

  // Connection drag state
  const [draftConnection, setDraftConnection] = useState<{
    sourceTaskId: string;
    mouseWorld: Point;
  } | null>(null);

  // Modals state
  const [isCreateEpicOpen, setIsCreateEpicOpen] = useState(false);
  const [editingEpic, setEditingEpic] = useState<Epic | null>(null);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [spawnCoords, setSpawnCoords] = useState<Point>({ x: 200, y: 150 });

  // Convert client viewport coordinates to canvas world coordinates
  const clientToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = containerRef.current?.getBoundingClientRect();
      const originX = rect ? rect.left : 0;
      const originY = rect ? rect.top : 0;
      return {
        x: (clientX - originX - pan.x) / zoom,
        y: (clientY - originY - pan.y) / zoom,
      };
    },
    [pan, zoom]
  );

  // Get center point of visible viewport in canvas world coordinates
  const getCanvasCenterWorld = useCallback((): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    const w = rect ? rect.width : window.innerWidth;
    const h = rect ? rect.height : window.innerHeight;
    return {
      x: (w / 2 - pan.x) / zoom - 130,
      y: (h / 2 - pan.y) / zoom - 60,
    };
  }, [pan, zoom]);

  // Canvas background panning
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Only pan if clicking on empty canvas background
    if (
      e.button === 1 || // Middle mouse button
      e.target === containerRef.current ||
      (e.target as HTMLElement).classList.contains('canvas-background')
    ) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isPanning) {
        setPan({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
      }

      // Update draft connection tip position if dragging
      if (draftConnection) {
        setDraftConnection((prev) =>
          prev ? { ...prev, mouseWorld: clientToWorld(e.clientX, e.clientY) } : null
        );
      }
    };

    const onMouseUp = () => {
      if (isPanning) setIsPanning(false);
      if (draftConnection) setDraftConnection(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isPanning, panStart, draftConnection, clientToWorld]);

  // Wheel zoom / pan
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      setZoom((prev) => Math.min(2.0, Math.max(0.3, Number((prev * zoomFactor).toFixed(2)))));
    } else {
      setPan((prev) => ({
        x: prev.x - e.deltaX * 0.8,
        y: prev.y - e.deltaY * 0.8,
      }));
    }
  };

  // Zoom controls
  const handleZoomIn = () => setZoom((prev) => Math.min(2.0, Number((prev + 0.1).toFixed(1))));
  const handleZoomOut = () => setZoom((prev) => Math.max(0.3, Number((prev - 0.1).toFixed(1))));
  const handleResetView = () => {
    setZoom(1.0);
    setPan({ x: 30, y: 30 });
  };

  // Auto Layout
  const handleAutoLayout = async () => {
    const layout = calculateAutoLayout(epics, tasks);
    await batchUpdatePositions({
      epics: layout.epics,
      tasks: layout.tasks,
    });
    setPan({ x: 40, y: 40 });
    setZoom(0.95);
  };

  // Quick creation triggers
  const handleOpenCreateEpic = () => {
    setSpawnCoords(getCanvasCenterWorld());
    setEditingEpic(null);
    setIsCreateEpicOpen(true);
  };

  const handleOpenCreateTask = () => {
    setSpawnCoords(getCanvasCenterWorld());
    setIsCreateTaskOpen(true);
  };

  // Connection Drag Handlers
  const handleStartConnect = (sourceTaskId: string, e: React.MouseEvent) => {
    const worldPt = clientToWorld(e.clientX, e.clientY);
    setDraftConnection({
      sourceTaskId,
      mouseWorld: worldPt,
    });
  };

  const handleEndConnect = async (targetTaskId: string) => {
    if (draftConnection && currentProject) {
      const { sourceTaskId } = draftConnection;
      if (sourceTaskId !== targetTaskId) {
        try {
          await createDependency({
            projectId: currentProject.id,
            sourceTaskId,
            targetTaskId,
          });
        } catch (err) {
          console.error('Failed to create dependency edge:', err);
        }
      }
    }
    setDraftConnection(null);
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleCanvasMouseDown}
      onWheel={handleWheel}
      className={`relative flex-1 w-full h-full overflow-hidden bg-[#F4F4F1] select-none ${
        isPanning ? 'cursor-grabbing' : 'cursor-default'
      }`}
    >
      {/* Interactive Infinite Canvas Space */}
      <div
        className="canvas-background absolute inset-0 w-full h-full"
        style={{
          backgroundColor: '#F4F4F1',
          backgroundImage: `radial-gradient(circle, #D4D4D8 1.25px, transparent 1.25px)`,
          backgroundSize: `${28 * zoom}px ${28 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        {/* World Transform Layer */}
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
        >
          {/* SVG Layer: Dependency edges & active drag wire */}
          <CanvasDependencyEdges draftConnection={draftConnection} />

          {/* Epics Layer (Semi-transparent container boxes) */}
          <div className="absolute inset-0 pointer-events-auto">
            {epics.map((epic) => (
              <CanvasEpicFrame
                key={epic.id}
                epic={epic}
                zoom={zoom}
                isDropTarget={hoveringEpicId === epic.id}
                onEditEpic={(e) => {
                  setEditingEpic(e);
                  setIsCreateEpicOpen(true);
                }}
              />
            ))}
          </div>

          {/* Tasks Layer (Floating task nodes) */}
          <div className="absolute inset-0 pointer-events-auto">
            {tasks.map((task) => (
              <CanvasTaskNode
                key={task.id}
                task={task}
                zoom={zoom}
                epics={epics}
                onHoverEpic={setHoveringEpicId}
                onStartConnect={handleStartConnect}
                onEndConnect={handleEndConnect}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Floating Bottom Docks (Zoom on left, Creative dock in center, Help on right) */}
      <CanvasToolbar
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetView={handleResetView}
        onAutoLayout={handleAutoLayout}
        onOpenCreateEpic={handleOpenCreateEpic}
        onOpenCreateTask={handleOpenCreateTask}
      />

      {/* Create / Edit Epic Modal */}
      <CanvasQuickEpicModal
        isOpen={isCreateEpicOpen}
        spawnPosition={spawnCoords}
        epicToEdit={editingEpic}
        onClose={() => {
          setIsCreateEpicOpen(false);
          setEditingEpic(null);
        }}
      />

      {/* Create Task Modal */}
      <CanvasQuickTaskModal
        isOpen={isCreateTaskOpen}
        spawnPosition={spawnCoords}
        epics={epics}
        onClose={() => setIsCreateTaskOpen(false)}
      />
    </div>
  );
}
