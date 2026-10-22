import React, { useState } from 'react';
import { useWorkroomStore } from '../../store/useWorkroomStore';
import KanbanToolbar from './kanban/KanbanToolbar';
import KanbanFlatView from './kanban/KanbanFlatView';
import KanbanSwimlanesView from './kanban/KanbanSwimlanesView';
import QuickTaskModal from './kanban/QuickTaskModal';
import type { KanbanMode } from './kanban/kanbanTypes';
import type { Task, TaskPriority, TaskStatus } from '../../types/workroom';

export default function KanbanView() {
  const {
    currentProject,
    epics,
    tasks,
    subtasks,
    dependencies,
    users,
    updateTask,
    createTask,
    setSelectedTaskId,
    selectedAssigneeFilter,
  } = useWorkroomStore();

  const [mode, setMode] = useState<KanbanMode>('flat');
  const [searchTerm, setSearchTerm] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');

  // Drag & Drop State
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);

  // Quick Task Modal
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [modalStatus, setModalStatus] = useState<TaskStatus>('todo');
  const [modalEpicId, setModalEpicId] = useState<string | null>(null);

  if (!currentProject) return null;

  // Filter tasks
  const filteredTasks = tasks.filter((task) => {
    const matchesSearch =
      task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (task.description && task.description.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;
    const matchesAssignee =
      assigneeFilter === 'all' ||
      (assigneeFilter === 'unassigned' ? !task.assigneeId : task.assigneeId === assigneeFilter);
    const matchesGlobalAssignee =
      !selectedAssigneeFilter || task.assigneeId === selectedAssigneeFilter;
    return matchesSearch && matchesPriority && matchesAssignee && matchesGlobalAssignee;
  });

  // Native HTML5 Drag Handlers
  const handleDragStart = (e: React.DragEvent, task: Task) => {
    setDraggedTaskId(task.id);
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetKey !== targetKey) {
      setDropTargetKey(targetKey);
    }
  };

  const handleDragLeave = (e: React.DragEvent, targetKey: string) => {
    if (dropTargetKey === targetKey) {
      setDropTargetKey(null);
    }
  };

  const handleDrop = async (
    e: React.DragEvent,
    targetStatus: TaskStatus,
    targetEpicId?: string | null
  ) => {
    e.preventDefault();
    setDropTargetKey(null);
    const taskId = draggedTaskId || e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const statusChanged = task.status !== targetStatus;
    const epicChanged = targetEpicId !== undefined && task.epicId !== targetEpicId;

    if (!statusChanged && !epicChanged) return;

    const updatePayload: Partial<Task> = {};
    if (statusChanged) updatePayload.status = targetStatus;
    if (targetEpicId !== undefined) updatePayload.epicId = targetEpicId;

    await updateTask(taskId, updatePayload);
    setDraggedTaskId(null);
  };

  const handleOpenCreateTask = (status: TaskStatus = 'todo', epicId: string | null = null) => {
    setModalStatus(status);
    setModalEpicId(epicId);
    setIsTaskModalOpen(true);
  };

  const handleCreateTaskSubmit = async (
    title: string,
    status: TaskStatus,
    priority: TaskPriority,
    epicId: string | null
  ) => {
    await createTask({
      projectId: currentProject.id,
      title,
      status,
      priority,
      epicId,
    });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden space-y-4 pb-2">
      {/* Top Filter & Mode Switcher Toolbar */}
      <KanbanToolbar
        mode={mode}
        onModeChange={setMode}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={setPriorityFilter}
        assigneeFilter={assigneeFilter}
        onAssigneeFilterChange={setAssigneeFilter}
        users={users}
        onOpenCreateTask={() => handleOpenCreateTask('todo', null)}
      />

      {/* Kanban Board Container */}
      <div className="flex-1 overflow-y-auto pr-1">
        {mode === 'flat' ? (
          <KanbanFlatView
            tasks={filteredTasks}
            allTasks={tasks}
            epics={epics}
            users={users}
            subtasks={subtasks}
            dependencies={dependencies}
            dropTargetKey={dropTargetKey}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onCardClick={(id) => setSelectedTaskId(id)}
            onOpenCreateTask={(st) => handleOpenCreateTask(st, null)}
          />
        ) : (
          <KanbanSwimlanesView
            tasks={filteredTasks}
            allTasks={tasks}
            epics={epics}
            users={users}
            subtasks={subtasks}
            dependencies={dependencies}
            dropTargetKey={dropTargetKey}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onCardClick={(id) => setSelectedTaskId(id)}
            onOpenCreateTask={handleOpenCreateTask}
          />
        )}
      </div>

      {/* Quick Task Creation Modal */}
      <QuickTaskModal
        isOpen={isTaskModalOpen}
        initialStatus={modalStatus}
        initialEpicId={modalEpicId}
        epics={epics}
        onClose={() => setIsTaskModalOpen(false)}
        onSubmit={handleCreateTaskSubmit}
      />
    </div>
  );
}
