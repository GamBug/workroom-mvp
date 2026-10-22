import React, { useState } from 'react';
import {
  Link as LinkIcon,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Trash2,
  Plus,
} from 'lucide-react';
import type { Task, TaskDependency } from '../../../types/workroom';

interface TaskDependenciesSectionProps {
  currentTaskId: string;
  projectId: string;
  tasks: Task[];
  dependencies: TaskDependency[];
  onCreateDependency: (payload: { projectId: string; sourceTaskId: string; targetTaskId: string }) => Promise<any>;
  onDeleteDependency: (id: string) => Promise<any>;
}

export default function TaskDependenciesSection({
  currentTaskId,
  projectId,
  tasks,
  dependencies,
  onCreateDependency,
  onDeleteDependency,
}: TaskDependenciesSectionProps) {
  const [prereqCandidateId, setPrereqCandidateId] = useState('');
  const [depError, setDepError] = useState<string | null>(null);

  // Prerequisites: Tasks that must be finished before THIS task (sourceTaskId -> currentTaskId)
  const prerequisites = dependencies
    .filter((d) => d.targetTaskId === currentTaskId)
    .map((d) => ({
      dependencyId: d.id,
      task: tasks.find((t) => t.id === d.sourceTaskId),
    }))
    .filter((p) => p.task !== undefined);

  // Blocking: Tasks that are blocked by THIS task (currentTaskId -> targetTaskId)
  const blocking = dependencies
    .filter((d) => d.sourceTaskId === currentTaskId)
    .map((d) => ({
      dependencyId: d.id,
      task: tasks.find((t) => t.id === d.targetTaskId),
    }))
    .filter((b) => b.task !== undefined);

  // Tasks eligible to be added as prerequisites (exclude self & already prerequisites)
  const existingPrereqIds = new Set(prerequisites.map((p) => p.task!.id));
  const candidateTasks = tasks.filter((t) => t.id !== currentTaskId && !existingPrereqIds.has(t.id));

  const handleAddPrerequisite = async () => {
    if (!prereqCandidateId) return;
    try {
      setDepError(null);
      await onCreateDependency({
        projectId,
        sourceTaskId: prereqCandidateId,
        targetTaskId: currentTaskId,
      });
      setPrereqCandidateId('');
    } catch (err: any) {
      setDepError(err.message || 'Không thể tạo liên kết');
    }
  };

  return (
    <div className="space-y-4 p-4 rounded-xl bg-zinc-50 border border-zinc-200">
      <div className="flex items-center gap-2">
        <LinkIcon className="w-4 h-4 text-zinc-700" />
        <h4 className="text-xs font-semibold text-zinc-800">
          Quan hệ Phụ thuộc (Dependencies)
        </h4>
      </div>

      {depError && (
        <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
          {depError}
        </div>
      )}

      {/* 1. Prerequisites (Cần hoàn thành trước) */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-medium text-zinc-500">
          Cần hoàn thành trước (Prerequisites):
        </span>

        {prerequisites.length === 0 ? (
          <p className="text-xs text-zinc-400 italic">Không có task tiền đề nào (Task sẵn sàng bắt đầu).</p>
        ) : (
          prerequisites.map(({ dependencyId, task: srcTask }) => {
            const isDone = srcTask!.status === 'done';
            return (
              <div
                key={dependencyId}
                className="flex items-center justify-between p-2 rounded-lg bg-white border border-zinc-200 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="text-zinc-800 font-medium">{srcTask!.title}</span>
                  {isDone ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-normal">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" strokeWidth={1.75} /> Đã xong
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-normal">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" strokeWidth={1.75} /> Đang chặn ({srcTask!.status})
                    </span>
                  )}
                </div>

                <button
                  onClick={() => onDeleteDependency(dependencyId)}
                  className="text-zinc-400 hover:text-red-600 transition p-1 rounded hover:bg-red-50 cursor-pointer"
                  title="Xóa liên kết tiền đề"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* 2. Blocking (Đang chặn các task khác) */}
      <div className="space-y-1.5 pt-2 border-t border-zinc-200/80">
        <span className="text-[11px] font-medium text-zinc-500">
          Đang chặn các task (Blocking):
        </span>

        {blocking.length === 0 ? (
          <p className="text-xs text-zinc-400 italic">Không chặn task nào khác.</p>
        ) : (
          blocking.map(({ dependencyId, task: tgtTask }) => (
            <div
              key={dependencyId}
              className="flex items-center justify-between p-2 rounded-lg bg-white border border-zinc-200 text-xs"
            >
              <div className="flex items-center gap-2">
                <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-zinc-800 font-medium">{tgtTask!.title}</span>
                <span className="text-[10px] text-zinc-400 font-mono">({tgtTask!.status})</span>
              </div>

              <button
                onClick={() => onDeleteDependency(dependencyId)}
                className="text-zinc-400 hover:text-red-600 transition p-1 rounded hover:bg-red-50"
                title="Xóa liên kết"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add Prerequisite Form */}
      {candidateTasks.length > 0 && (
        <div className="pt-2 border-t border-zinc-200/80 flex gap-2 items-center">
          <select
            value={prereqCandidateId}
            onChange={(e) => setPrereqCandidateId(e.target.value)}
            className="flex-1 bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs text-zinc-800 focus:outline-none focus:border-zinc-400"
          >
            <option value="">-- Chọn Task làm tiền đề (Prerequisite) --</option>
            {candidateTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} ({t.status})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleAddPrerequisite}
            disabled={!prereqCandidateId}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition flex items-center gap-1 shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Thêm tiền đề
          </button>
        </div>
      )}
    </div>
  );
}
