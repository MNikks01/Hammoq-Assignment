import type { UserDto } from '@taskmanager/contracts';
import { model, Schema, type InferSchemaType, type Types } from 'mongoose';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Normalized (trimmed + lowercased) before it reaches the model; uniqueness is
    // enforced by the database index, not by a racy "find then insert".
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: 'throw', versionKey: false },
);

userSchema.index({ email: 1 }, { unique: true, name: 'email_unique' });

export type UserRecord = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

export const User = model('User', userSchema);

export function toUserDto(
  u: Pick<UserRecord, '_id' | 'name' | 'email' | 'createdAt' | 'updatedAt'>,
): UserDto {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}
