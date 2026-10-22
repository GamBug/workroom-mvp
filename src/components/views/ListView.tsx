import React, { useState } from 'react';
import { useWorkroomStore } from '../../store/useWorkroomStore';
import type { TaskPriority } from '../../types/workroom';
import { EPIC_COLORS } from './list/listConstants';
import ListToolbar from './list/ListToolbar';
import ListEpicSection from './list/ListEpicSection';
import ListUnassignedSection from './list/ListUnassignedSection';
import { ListEpicModal, ListTaskModal } from './list/ListModals';

export default function ListView() {
  const {
    currentProject,
    epics,
    tasks,
    subtasks,
    dependencies,
    users,
    createEpic,
    updateEpic,
    deleteEpic,
    createTask,
    updateTask,
    deleteTask,
    createSubtask,
    toggleSubtask,
    setSelectedTaskId,
    setActivePreviewDocId,
    selectedAssigneeFilter,
  } = useWorkroomStore();

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');

  // Collapsible Epic sections state (epicId -> boolean)
  const [collapsedEpics, setCollapsedEpics] = useState<Record<string, boolean>>({});
  const [isUnassignedCollapsed, setIsUnassignedCollapsed] = useState(false);

  // Expanded task subtasks accordion state (taskId -> boolean)
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});
  const [quickSubtaskInputs, setQuickSubtaskInputs] = useState<Record<string, string>>({});

  // Modals state
  const [isEpicModalOpen, setIsEpicModalOpen] = useState(false);
  const [editingEpicId, setEditingEpicId] = useState<string | null>(null);
  const [epicTitle, setEpicTitle] = useState('');
  const [epicColor, setEpicColor] = useState(EPIC_COLORS[0]);

  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskTargetEpicId, setTaskTargetEpicId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('medium');

  if (!currentProject) return null;

  // Toggle Epic Collapsed
  const toggleEpicCollapse = (epicId: string) => {
    setCollapsedEpics((prev) => ({ ...prev, [epicId]: !prev[epicId] }));
  };

  // Toggle Task Subtasks accordion
  const toggleTaskAccordion = (taskId: string) => {
    setExpandedTasks((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  // Quick add subtask inline on ListView
  const handleQuickAddSubtask = async (e: React.FormEvent, taskId: string) => {
    e.preventDefault();
    const val = quickSubtaskInputs[taskId]?.trim();
    if (!val) return;
    await createSubtask({ taskId, title: val });
    setQuickSubtaskInputs((prev) => ({ ...prev, [taskId]: '' }));
  };

  // Filter tasks
  const filteredTasks = tasks.filter((task) => {
    const matchesSearch =
      task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (task.description && task.description.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
    const matchesAssignee =
      assigneeFilter === 'all' ||
      (assigneeFilter === 'unassigned' ? !task.assigneeId : task.assigneeId === assigneeFilter);
    const matchesGlobalAssignee =
      !selectedAssigneeFilter || task.assigneeId === selectedAssigneeFilter;
    return matchesSearch && matchesStatus && matchesAssignee && matchesGlobalAssignee;
  });

  // Epic modal submit
  const handleEpicSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!epicTitle.trim()) return;

    if (editingEpicId) {
      await updateEpic(editingEpicId, { title: epicTitle.trim(), color: epicColor });
    } else {
      await createEpic({
        projectId: currentProject.id,
        title: epicTitle.trim(),
        color: epicColor,
      });
    }
    setIsEpicModalOpen(false);
    setEditingEpicId(null);
    setEpicTitle('');
  };

  const handleOpenEditEpic = (epicId: string, currentTitle: string, currentColor: string) => {
    setEditingEpicId(epicId);
    setEpicTitle(currentTitle);
    setEpicColor(currentColor);
    setIsEpicModalOpen(true);
  };

  const handleDeleteEpic = async (epicId: string, title: string) => {
    if (window.confirm(`Xóa Epic "${title}"? Các Task thuộc Epic này sẽ được chuyển thành Task độc lập (không bị xóa).`)) {
      await deleteEpic(epicId);
    }
  };

  const handleDeleteTask = async (taskId: string, title: string) => {
    if (window.confirm(`Xóa task "${title}"?`)) {
      await deleteTask(taskId);
    }
  };

  // Quick Task Create submit
  const handleCreateTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    await createTask({
      projectId: currentProject.id,
      epicId: taskTargetEpicId,
      title: newTaskTitle.trim(),
      priority: newTaskPriority,
      status: 'todo',
    });

    setIsTaskModalOpen(false);
    setNewTaskTitle('');
    setTaskTargetEpicId(null);
  };

  const openCreateTaskModal = (epicId: string | null = null) => {
    setTaskTargetEpicId(epicId);
    setNewTaskTitle('');
    setIsTaskModalOpen(true);
  };

  const unassignedTasks = filteredTasks.filter((t) => t.epicId === null);

  return (
    <div className="h-full flex flex-col overflow-y-auto space-y-4 pb-12">
      {/* Toolbar */}
      <ListToolbar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        assigneeFilter={assigneeFilter}
        onAssigneeFilterChange={setAssigneeFilter}
        users={users}
        onOpenCreateEpic={() => {
          setEditingEpicId(null);
          setEpicTitle('');
          setEpicColor(EPIC_COLORS[0]);
          setIsEpicModalOpen(true);
        }}
        onOpenCreateTask={() => openCreateTaskModal(null)}
      />

      {/* Epics Sections */}
      <div className="space-y-4">
        {epics.map((epic) => (
          <ListEpicSection
            key={epic.id}
            epic={epic}
            epicTasks={filteredTasks.filter((t) => t.epicId === epic.id)}
            allTasks={tasks}
            subtasks={subtasks}
            dependencies={dependencies}
            users={users}
            isCollapsed={!!collapsedEpics[epic.id]}
            expandedTasks={expandedTasks}
            quickSubtaskInputs={quickSubtaskInputs}
            onToggleCollapse={toggleEpicCollapse}
            onToggleTaskAccordion={toggleTaskAccordion}
            onQuickSubtaskInputChange={(taskId, val) =>
              setQuickSubtaskInputs((prev) => ({ ...prev, [taskId]: val }))
            }
            onQuickAddSubtask={handleQuickAddSubtask}
            onSelectTask={setSelectedTaskId}
            onUpdateTask={updateTask}
            onDeleteTask={handleDeleteTask}
            onToggleSubtask={toggleSubtask}
            onPreviewDoc={setActivePreviewDocId}
            onOpenCreateTaskInEpic={openCreateTaskModal}
            onOpenEditEpic={handleOpenEditEpic}
            onDeleteEpic={handleDeleteEpic}
          />
        ))}

        {/* Independent Tasks Section */}
        <ListUnassignedSection
          unassignedTasks={unassignedTasks}
          allTasks={tasks}
          subtasks={subtasks}
          dependencies={dependencies}
          users={users}
          isCollapsed={isUnassignedCollapsed}
          expandedTasks={expandedTasks}
          quickSubtaskInputs={quickSubtaskInputs}
          onToggleCollapse={() => setIsUnassignedCollapsed(!isUnassignedCollapsed)}
          onToggleTaskAccordion={toggleTaskAccordion}
          onQuickSubtaskInputChange={(taskId, val) =>
            setQuickSubtaskInputs((prev) => ({ ...prev, [taskId]: val }))
          }
          onQuickAddSubtask={handleQuickAddSubtask}
          onSelectTask={setSelectedTaskId}
          onUpdateTask={updateTask}
          onDeleteTask={handleDeleteTask}
          onToggleSubtask={toggleSubtask}
          onPreviewDoc={setActivePreviewDocId}
          onOpenCreateTask={() => openCreateTaskModal(null)}
        />
      </div>

      {/* Modals */}
      <ListEpicModal
        isOpen={isEpicModalOpen}
        editingEpicId={editingEpicId}
        epicTitle={epicTitle}
        epicColor={epicColor}
        onEpicTitleChange={setEpicTitle}
        onEpicColorChange={setEpicColor}
        onClose={() => setIsEpicModalOpen(false)}
        onSubmit={handleEpicSubmit}
      />

      <ListTaskModal
        isOpen={isTaskModalOpen}
        newTaskTitle={newTaskTitle}
        newTaskPriority={newTaskPriority}
        taskTargetEpicId={taskTargetEpicId}
        epics={epics}
        onTitleChange={setNewTaskTitle}
        onPriorityChange={setNewTaskPriority}
        onEpicIdChange={setTaskTargetEpicId}
        onClose={() => setIsTaskModalOpen(false)}
        onSubmit={handleCreateTaskSubmit}
      />
    </div>
  );
}
