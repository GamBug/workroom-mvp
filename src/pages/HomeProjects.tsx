import React, { useEffect, useState } from 'react';
import { useWorkroomStore } from '../store/useWorkroomStore';
import {
  FolderKanban,
  Plus,
  Trash2,
  Calendar,
  LogOut,
  FolderOpen,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import CreateProjectModal from '../components/home/CreateProjectModal';

export default function HomeProjects() {
  const {
    currentUser,
    users,
    projects,
    isLoading,
    error,
    logout,
    fetchProjects,
    fetchUsers,
    deleteProject,
    loadProjectWorkspace,
    fetchProjectFullData,
    resetDemoData,
  } = useWorkroomStore();

  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    fetchProjects();
    fetchUsers();
  }, [fetchProjects, fetchUsers]);

  const handleSelectProject = (projectId: string) => {
    loadProjectWorkspace(projectId);
  };

  const handleDeleteProject = async (e: React.MouseEvent, projectId: string, projectName: string) => {
    e.stopPropagation();
    if (window.confirm(`Bạn có chắc chắn muốn xóa dự án "${projectName}"? Tất cả tasks và tài liệu sẽ bị xóa.`)) {
      await deleteProject(projectId);
    }
  };

  const getOwner = (ownerId: string) => {
    return users.find((u) => u.id === ownerId) || (currentUser?.id === ownerId ? currentUser : null);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-zinc-900 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="border-b border-zinc-200 bg-white sticky top-0 z-20 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-zinc-900 rounded-lg text-white shadow-xs">
              <FolderKanban className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-zinc-900 tracking-tight">Mini Workroom</h1>
              <span className="text-[11px] text-zinc-400 font-normal">Project Workspace</span>
            </div>
          </div>

          {/* User info & Logout */}
          {currentUser && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-50 border border-zinc-200">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-xs"
                  style={{ backgroundColor: currentUser.avatarColor }}
                >
                  {currentUser.displayName[0]?.toUpperCase() || currentUser.username[0]?.toUpperCase()}
                </span>
                <span className="text-xs font-medium text-zinc-700 hidden sm:inline">{currentUser.displayName}</span>
              </div>

              <button
                onClick={logout}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition cursor-pointer"
                title="Đăng xuất"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        {/* Title & Actions Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-7 pb-4 border-b border-zinc-200/70">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">Danh sách Dự án</h2>
            <p className="text-zinc-500 text-xs mt-0.5">
              Chọn một dự án để mở không gian làm việc hoặc khởi tạo dự án mới
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <button
              onClick={() => {
                if (window.confirm('Khôi phục toàn bộ dữ liệu mẫu ban đầu? Mọi thay đổi thử nghiệm sẽ bị làm mới.')) {
                  resetDemoData();
                }
              }}
              title="Khôi phục toàn bộ dữ liệu mẫu ban đầu"
              className="px-3 py-2 bg-white hover:bg-zinc-50 text-zinc-700 border border-zinc-200 text-xs font-medium rounded-lg transition flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-zinc-500" />
              <span>Reset Demo</span>
            </button>

            <button
              onClick={() => setIsModalOpen(true)}
              className="px-3.5 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium rounded-lg transition shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Tạo Project Mới
            </button>
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
            {error}
          </div>
        )}

        {/* Projects Grid */}
        {isLoading && projects.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-zinc-400 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
              Đang tải danh sách dự án...
            </div>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-zinc-200 rounded-2xl bg-white p-8">
            <div className="w-12 h-12 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-400 mx-auto mb-3">
              <FolderOpen className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-900 mb-1">Chưa có dự án nào</h3>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto mb-4">
              Bắt đầu bằng cách tạo dự án đầu tiên của bạn để quản lý các task, epic và tài liệu.
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-3.5 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium rounded-lg shadow-xs inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Tạo Dự Án Ngay
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => {
              const owner = getOwner(project.ownerId);
              const formattedDate = new Date(project.createdAt).toLocaleDateString('vi-VN', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              });

              return (
                <div
                  key={project.id}
                  onClick={() => handleSelectProject(project.id)}
                  className="bg-white border border-zinc-200/90 hover:border-zinc-300 rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all cursor-pointer group flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3 className="text-sm font-bold text-zinc-900 group-hover:text-zinc-700 transition truncate">
                        {project.name}
                      </h3>
                      <button
                        onClick={(e) => handleDeleteProject(e, project.id, project.name)}
                        className="p-1 rounded text-zinc-300 hover:text-red-600 hover:bg-red-50 transition opacity-0 group-hover:opacity-100 cursor-pointer"
                        title="Xóa dự án"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed mb-4">
                      {project.description || 'Chưa có mô tả cho dự án này.'}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-zinc-100 flex items-center justify-between text-[11px] text-zinc-400">
                    <div className="flex items-center gap-2">
                      {owner && (
                        <div className="flex items-center gap-1.5" title={`Tạo bởi: ${owner.displayName}`}>
                          <span
                            className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                            style={{ backgroundColor: owner.avatarColor }}
                          >
                            {owner.displayName[0]?.toUpperCase() || owner.username[0]?.toUpperCase()}
                          </span>
                          <span className="truncate max-w-[80px]">{owner.displayName}</span>
                        </div>
                      )}
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formattedDate}
                      </span>
                    </div>

                    <span className="text-zinc-400 group-hover:text-zinc-900 group-hover:translate-x-0.5 transition-all">
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Create Project Modal */}
      <CreateProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
