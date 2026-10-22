import React, { useState, useEffect } from 'react';
import { useWorkroomStore } from '../../store/useWorkroomStore';
import { X, Trash2, CheckSquare } from 'lucide-react';
import MentionDescriptionBox from './MentionDescriptionBox';
import TaskPropertiesBar from './taskDetail/TaskPropertiesBar';
import TaskSubtasksSection from './taskDetail/TaskSubtasksSection';
import TaskDependenciesSection from './taskDetail/TaskDependenciesSection';

export default function TaskDetailModal() {
  const {
    currentProject,
    tasks,
    epics,
    subtasks,
    dependencies,
    users,
    selectedTaskId,
    setSelectedTaskId,
    updateTask,
    deleteTask,
    createSubtask,
    toggleSubtask,
    deleteSubtask,
    createDependency,
    deleteDependency,
  } = useWorkroomStore();

  const task = tasks.find((t) => t.id === selectedTaskId);

  // Local form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
    }
  }, [task?.id, task?.title, task?.description]);

  if (!task || !currentProject) return null;

  const taskSubtasks = subtasks.filter((s) => s.taskId === task.id);

  // Handlers for updates
  const handleTitleBlur = async () => {
    if (title.trim() && title !== task.title) {
      await updateTask(task.id, { title: title.trim() });
    }
  };

  const handleDescriptionBlur = async () => {
    if (description !== task.description) {
      await updateTask(task.id, { description });
    }
  };

  const handleDeleteTask = async () => {
    if (window.confirm(`Xóa task "${task.title}"? Các subtask và liên kết phụ thuộc sẽ bị xóa theo.`)) {
      await deleteTask(task.id);
      setSelectedTaskId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
      <div className="bg-white border border-zinc-200 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden relative">
        {/* Modal Header */}
        <div className="px-6 py-3.5 border-b border-zinc-100 flex items-center justify-between gap-4 bg-white flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="p-1.5 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-700">
              <CheckSquare className="w-4 h-4" />
            </span>
            <div>
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400">
                Chi tiết công việc • {task.id.slice(0, 8)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleDeleteTask}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 transition"
              title="Xóa Task"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setSelectedTaskId(null)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition"
              title="Đóng (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Title input */}
          <div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="Tiêu đề Task..."
              className="w-full text-lg font-bold text-zinc-900 bg-transparent border-b border-transparent hover:border-zinc-200 focus:border-zinc-400 focus:outline-none pb-1 transition"
            />
          </div>

          {/* Quick Properties Bar (Epic, Status, Priority, Assignee) */}
          <TaskPropertiesBar
            task={task}
            epics={epics}
            users={users}
            onStatusChange={(status) => updateTask(task.id, { status })}
            onPriorityChange={(priority) => updateTask(task.id, { priority })}
            onEpicChange={(epicId) => updateTask(task.id, { epicId: epicId === '' ? null : epicId })}
            onAssigneeChange={(assigneeId) =>
              updateTask(task.id, { assigneeId: assigneeId === '' ? null : assigneeId })
            }
          />

          {/* Description with @mention support and interactive doc chips */}
          <MentionDescriptionBox
            value={description}
            onChange={(val) => setDescription(val)}
            onBlur={handleDescriptionBlur}
          />

          {/* Subtasks (Checklist) */}
          <TaskSubtasksSection
            taskId={task.id}
            subtasks={taskSubtasks}
            onCreateSubtask={createSubtask}
            onToggleSubtask={toggleSubtask}
            onDeleteSubtask={deleteSubtask}
          />

          {/* Task Dependencies Section */}
          <TaskDependenciesSection
            currentTaskId={task.id}
            projectId={currentProject.id}
            tasks={tasks}
            dependencies={dependencies}
            onCreateDependency={createDependency}
            onDeleteDependency={deleteDependency}
          />
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-zinc-100 bg-zinc-50 flex items-center justify-end">
          <button
            onClick={() => setSelectedTaskId(null)}
            className="px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-xs font-medium transition shadow-xs"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
