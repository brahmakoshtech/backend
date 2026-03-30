import mongoose from 'mongoose';

const clientNotificationGroupSchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    userIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    isActive: {
      type: Boolean,
      default: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true
    }
  },
  { timestamps: true }
);

clientNotificationGroupSchema.index({ clientId: 1, createdAt: -1 });
clientNotificationGroupSchema.index({ clientId: 1, name: 1 });

export default mongoose.model('ClientNotificationGroup', clientNotificationGroupSchema);
