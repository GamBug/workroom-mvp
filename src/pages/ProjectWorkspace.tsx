import React, { useState, useEffect } from 'react';
import { useWorkroomStore } from '../store/useWorkroomStore';
import {
  ArrowLeft,
  Columns,
  List,
  Network,
  BookOpen,
} from 'lucide-react';
import type { WorkspaceView, ProjectDoc } from '../types/workroom';
import ListView from '../components/views/ListView';
import KanbanView from '../components/views/KanbanView';
import CanvasView from '../components/views/CanvasView';
import TaskDetailModal from '../components/shared/TaskDetailModal';
import DocHubDrawer from '../components/docs/DocHubDrawer';
import DocFormModal from '../components/docs/DocFormModal';
import DocPreviewModal from '../components/docs/DocPreviewModal';

export default function ProjectWorkspace() {
  const [isDocModalOpen, setIsDocModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<ProjectDoc | null>(null);

  const {
    currentUser,
    currentProjectId,
    currentProject,
    tasks,
    docs,
    users,
    isLoading,
    fetchProjectFullData,
    selectedAssigneeFilter,
    setSelectedAssigneeFilter,
    activeView,
    setActiveView,
    isDocHubOpen,
    toggleDocHub,
    setCurrentProjectId,
  } = useWorkroomStore();

  useEffect(() => {
    if (currentProjectId && !currentProject && !isLoading) {
      fetchProjectFullData(currentProjectId);
    }
  }, [currentProjectId, currentProject, isLoading, fetchProjectFullData]);

  const handleBackToProjects = () => {
    setCurrentProjectId(null);
  };

  if (isLoading || !currentProject) {
    if (isLoading) {
      return (
        <div className="min-h-screen bg-[#F8F9FA] text-zinc-900 flex items-center justify-center p-6">
          <div className="flex items-center gap-2.5 text-xs text-zinc-500 font-medium">
            <span className="w-4 h-4 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
            <span>Đang tải không gian làm việc...</span>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-[#F8F9FA] text-zinc-900 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <p className="text-zinc-500 text-sm">Không tìm thấy dự án đang mở.</p>
          <button
            onClick={handleBackToProjects}
            className="px-4 py-2 bg-zinc-900 rounded-lg text-white text-xs font-medium cursor-pointer"
          >
            Quay lại danh sách Project
          </button>
        </div>
      </div>
    );
  }

  const views: { id: WorkspaceView; label: string; icon: React.ReactNode }[] = [
    { id: 'list', label: 'List View', icon: <List className="w-3.5 h-3.5" /> },
    { id: 'kanban', label: 'Kanban View', icon: <Columns className="w-3.5 h-3.5" /> },
    { id: 'canvas', label: 'Canvas 2D', icon: <Network className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="h-screen bg-[#F8F9FA] text-zinc-900 flex flex-col overflow-hidden font-sans">
      {/* Topbar */}
      <header className="h-12 px-4 bg-white border-b border-zinc-200/80 flex items-center justify-between gap-4 flex-shrink-0 z-20">
        {/* Left: Breadcrumb */}
        <nav className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={handleBackToProjects}
            className="text-xs text-zinc-500 hover:text-zinc-900 cursor-pointer transition font-normal"
          >
            Workroom
          </button>
          <span className="text-zinc-300 text-xs select-none">/</span>
          <span className="text-xs font-medium text-zinc-900 truncate">
            {currentProject.name}
          </span>
        </nav>

        {/* Center: View Switcher (Segmented Control) */}
        <div className="flex items-center h-7 bg-zinc-100/80 p-0.5 rounded-md border border-zinc-200/60">
          {views.map((v) => {
            const isActive = activeView === v.id;
            return (
              <button
                key={v.id}
                onClick={() => setActiveView(v.id)}
                className={`flex items-center gap-1.5 h-6 px-2.5 rounded-[5px] text-[12px] transition cursor-pointer ${
                  isActive
                    ? 'bg-white text-zinc-900 shadow-xs font-medium'
                    : 'text-zinc-500 hover:text-zinc-800 font-normal'
                }`}
              >
                {v.icon}
                <span className="hidden md:inline">{v.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right: Team Avatars & Ghost Controls */}
        <div className="flex items-center gap-2">
          {/* Team Member Avatars (Global Assignee Filter) - No box, no counter badge overlay */}
          <div className="hidden lg:flex items-center -space-x-1">
            {users.map((u) => {
              const isSelected = selectedAssigneeFilter === u.id;
              const taskCount = tasks.filter((t) => t.assigneeId === u.id).length;
              return (
                <button
                  key={u.id}
                  onClick={() => setSelectedAssigneeFilter(isSelected ? null : u.id)}
                  title={`${u.displayName} (${taskCount} tasks) - ${isSelected ? 'Bỏ lọc' : 'Lọc theo thành viên này'}`}
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium text-white ring-2 ring-white transition cursor-pointer ${
                    isSelected
                      ? 'ring-zinc-900 scale-110 z-10'
                      : 'hover:scale-105 hover:z-10 opacity-85 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: u.avatarColor }}
                >
                  {u.displayName[0]?.toUpperCase() || u.username[0]?.toUpperCase()}
                </button>
              );
            })}
          </div>

          {selectedAssigneeFilter && (
            <button
              onClick={() => setSelectedAssigneeFilter(null)}
              title="Xóa bộ lọc thành viên"
              className="text-[11px] text-zinc-400 hover:text-zinc-800 font-normal cursor-pointer"
            >
              Bỏ lọc
            </button>
          )}

          {/* Vertical Divider */}
          <div className="h-4 w-[1px] bg-zinc-200 mx-1 hidden sm:block" />

          {/* Doc Hub Toggle as Ghost Button */}
          <button
            onClick={toggleDocHub}
            className={`h-7 px-2.5 text-[12px] rounded-md flex items-center gap-1.5 transition cursor-pointer ${
              isDocHubOpen
                ? 'bg-zinc-100 text-zinc-900 font-medium'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-zinc-500" strokeWidth={1.75} />
            <span className="hidden sm:inline">Tài liệu</span>
            <span className="text-[11px] text-zinc-400 font-normal">
              {docs.length}
            </span>
          </button>

          {/* Current User Avatar */}
          {currentUser && (
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium text-white ring-1 ring-zinc-200/80 flex-shrink-0"
              style={{ backgroundColor: currentUser.avatarColor }}
              title={`${currentUser.displayName} (@${currentUser.username})`}
            >
              {currentUser.displayName[0]?.toUpperCase() || currentUser.username[0]?.toUpperCase()}
            </div>
          )}
        </div>
      </header>

      {/* Main Workspace Body with optional Doc Hub Drawer */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Workspace Container */}
        <main className="flex-1 overflow-hidden p-4 flex flex-col bg-[#F8F9FA]">
          {activeView === 'list' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              <ListView />
            </div>
          )}

          {activeView === 'kanban' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              <KanbanView />
            </div>
          )}

          {activeView === 'canvas' && (
            <div className="flex-1 overflow-hidden flex flex-col rounded-xl border border-zinc-200/90 bg-[#F4F4F1] relative shadow-xs">
              <CanvasView />
            </div>
          )}
        </main>

        {/* Shared Docs (Doc Hub) Drawer Panel */}
        <DocHubDrawer
          onOpenCreateDoc={() => {
            setEditingDoc(null);
            setIsDocModalOpen(true);
          }}
          onEditDoc={(doc) => {
            setEditingDoc(doc);
            setIsDocModalOpen(true);
          }}
        />
      </div>

      {/* Shared Task Detail Modal */}
      <TaskDetailModal />

      {/* Create / Edit Doc Modal */}
      <DocFormModal
        isOpen={isDocModalOpen}
        docToEdit={editingDoc}
        onClose={() => {
          setIsDocModalOpen(false);
          setEditingDoc(null);
        }}
      />

      {/* Fast Doc Preview Modal */}
      <DocPreviewModal
        onEditDoc={(doc) => {
          setEditingDoc(doc);
          setIsDocModalOpen(true);
        }}
      />
    </div>
  );
}
