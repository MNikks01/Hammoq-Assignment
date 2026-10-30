import { model, Schema, type InferSchemaType, type Types } from 'mongoose';

/**
 * One document per issued refresh token. Rotation marks the old document as
 * replaced and inserts a new one in the same family; presenting a replaced token
 * again (outside a short grace window) is treated as theft and revokes the family.
 */
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    familyId: { type: String, required: true, immutable: true },
    tokenHash: { type: String, required: true, immutable: true },
    expiresAt: { type: Date, required: true },
    absoluteExpiresAt: { type: Date, required: true, immutable: true },
    replacedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, maxlength: 256, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw', versionKey: false },
);

sessionSchema.index({ tokenHash: 1 }, { unique: true, name: 'token_hash_unique' });
sessionSchema.index({ familyId: 1 }, { name: 'family' });
sessionSchema.index({ userId: 1 }, { name: 'user' });
// MongoDB's TTL monitor deletes expired sessions (runs roughly every 60s).
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expires_ttl' });

export type SessionRecord = InferSchemaType<typeof sessionSchema> & { _id: Types.ObjectId };

export const Session = model('Session', sessionSchema);
