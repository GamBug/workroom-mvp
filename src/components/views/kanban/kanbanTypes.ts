import type { TaskStatus } from '../../../types/workroom';

export type KanbanMode = 'flat' | 'swimlanes';

export interface ColumnDef {
  id: TaskStatus;
  title: string;
  colorClass: string;
  badgeClass: string;
  dotColor: string;
}

export const COLUMNS: ColumnDef[] = [
  {
    id: 'todo',
    title: 'To Do',
    colorClass: 'border-zinc-200',
    badgeClass: 'bg-zinc-100 text-zinc-600 border-zinc-200',
    dotColor: '#71717a',
  },
  {
    id: 'in_progress',
    title: 'In Progress',
    colorClass: 'border-amber-200',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    dotColor: '#d97706',
  },
  {
    id: 'review',
    title: 'In Review',
    colorClass: 'border-purple-200',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
    dotColor: '#9333ea',
  },
  {
    id: 'done',
    title: 'Done',
    colorClass: 'border-emerald-200',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotColor: '#16a34a',
  },
];
