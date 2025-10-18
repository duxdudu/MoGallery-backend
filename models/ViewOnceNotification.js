const mongoose = require('mongoose');

const viewOnceNotificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  media: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Media',
    required: true
  },
  folder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    required: true
  },
  title: {
    type: String,
    required: true,
    default: '🔒 View-Once Media Shared'
  },
  message: {
    type: String,
    required: true,
    default: 'You have received a view-once media file'
  },
  personalMessage: {
    type: String,
    required: false
  },
  mediaPreview: {
    thumbnailUrl: String,
    fileType: String,
    fileName: String,
    fileSize: Number
  },
  isViewed: {
    type: Boolean,
    default: false
  },
  viewedAt: {
    type: Date,
    required: false
  },
  expiresAt: {
    type: Date,
    required: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  viewCount: {
    type: Number,
    default: 0,
    max: 1
  },
  metadata: {
    deviceInfo: String,
    ipAddress: String,
    userAgent: String
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
viewOnceNotificationSchema.index({ recipient: 1, isActive: 1, createdAt: -1 });
viewOnceNotificationSchema.index({ media: 1, isActive: 1 });
viewOnceNotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Static method to create view-once notification
viewOnceNotificationSchema.statics.createViewOnceNotification = function(data) {
  const {
    recipientId,
    senderId,
    mediaId,
    folderId,
    personalMessage,
    mediaPreview,
    expiresInHours = 24
  } = data;

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expiresInHours);

  return this.create({
    recipient: recipientId,
    sender: senderId,
    media: mediaId,
    folder: folderId,
    personalMessage,
    mediaPreview,
    expiresAt,
    title: personalMessage ? `🔒 View-Once: ${personalMessage}` : '🔒 View-Once Media Shared',
    message: personalMessage || 'You have received a view-once media file'
  });
};

// Instance method to mark as viewed
viewOnceNotificationSchema.methods.markAsViewed = function(deviceInfo = null) {
  if (this.isViewed) {
    return Promise.resolve(this);
  }

  this.isViewed = true;
  this.viewedAt = new Date();
  this.viewCount = 1;
  
  if (deviceInfo) {
    this.metadata = {
      ...this.metadata,
      deviceInfo: deviceInfo.deviceInfo || 'Unknown',
      ipAddress: deviceInfo.ipAddress || 'Unknown',
      userAgent: deviceInfo.userAgent || 'Unknown'
    };
  }

  return this.save();
};

// Instance method to deactivate
viewOnceNotificationSchema.methods.deactivate = function() {
  this.isActive = false;
  return this.save();
};

// Static method to get active notifications for user
viewOnceNotificationSchema.statics.getActiveNotifications = function(userId, limit = 50) {
  return this.find({
    recipient: userId,
    isActive: true,
    isViewed: false,
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } }
    ]
  })
  .populate('sender', 'email')
  .populate('media', 'fileName filePath fileType originalName size')
  .populate('folder', 'name')
  .sort({ createdAt: -1 })
  .limit(limit);
};

// Static method to cleanup expired notifications
viewOnceNotificationSchema.statics.cleanupExpired = function() {
  return this.updateMany(
    {
      expiresAt: { $lt: new Date() },
      isActive: true
    },
    {
      $set: { isActive: false }
    }
  );
};

module.exports = mongoose.model('ViewOnceNotification', viewOnceNotificationSchema);

