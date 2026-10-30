import { TASK_LIMITS, TASK_PRIORITIES, TASK_STATUSES, type TaskPriority } from '@taskmanager/contracts';
import { model, Schema, type InferSchemaType, type Types } from 'mongoose';

/** Numeric rank so "sort by priority" orders high > medium > low instead of alphabetically. */
export const PRIORITY_RANK: Record<TaskPriority, number> = { low: 1, medium: 2, high: 3 };

const taskSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    title: { type: String, required: true, trim: true, maxlength: TASK_LIMITS.titleMax },
    description: { type: String, default: '', maxlength: TASK_LIMITS.descriptionMax },
    status: { type: String, enum: TASK_STATUSES, required: true, default: 'todo' },
    priority: { type: String, enum: TASK_PRIORITIES, required: true, default: 'medium' },
    priorityRank: { type: Number, required: true, min: 1, max: 3 },
    dueDate: { type: Date, default: null },
    tags: {
      type: [{ type: String, maxlength: TASK_LIMITS.tagMax }],
      default: [],
      validate: { validator: (v: string[]) => v.length <= TASK_LIMITS.tagsMax, message: 'Too many tags' },
    },
    completedAt: { type: Date, default: null },
    // Optimistic concurrency token, incremented on every write.
    version: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true, strict: 'throw', versionKey: false },
);

/*
 * Indexes follow the implemented query shapes (see docs/architecture.md#indexes).
 * Every one is prefixed with userId: all reads are tenant-scoped, and the
 * equality-first prefix keeps each query inside a single user's key range.
 * The trailing _id makes the index order match the API's stable sort
 * (<field>, _id), so paging never needs an in-memory SORT stage.
 */
taskSchema.index({ userId: 1, updatedAt: -1, _id: -1 }, { name: 'user_updated' });
taskSchema.index({ userId: 1, status: 1, updatedAt: -1, _id: -1 }, { name: 'user_status_updated' });
taskSchema.index({ userId: 1, dueDate: 1, _id: 1 }, { name: 'user_due' });
taskSchema.index({ userId: 1, createdAt: -1, _id: -1 }, { name: 'user_created' });
// Added after explain() showed priority sorting as a blocking SORT of every task of
// the heaviest seeded user (2,976 docs, ~57 ms). Title sort stays in-memory (it needs
// a collation-specific index and is rarely used); see docs/architecture.md.
taskSchema.index({ userId: 1, priorityRank: -1, _id: -1 }, { name: 'user_priority' });
// Text index with an equality prefix: $text queries must also match userId, so a
// search only touches the caller's postings.
taskSchema.index(
  { userId: 1, title: 'text', description: 'text' },
  { name: 'user_text', weights: { title: 5, description: 1 }, default_language: 'english' },
);

export type TaskRecord = InferSchemaType<typeof taskSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Task = model('Task', taskSchema);
