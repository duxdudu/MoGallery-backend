const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
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
  type: {
    type: String,
    enum: ['media_shared', 'media_view_once', 'folder_shared', 'media_scheduled'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  media: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Media',
    required: false
  },
  folder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    required: false
  },
  viewOnce: {
    type: Boolean,
    default: false
  },
  scheduledFor: {
    type: Date,
    required: false
  },
  expiresAt: {
    type: Date,
    required: false
  },
  isRead: {
    type: Boolean,
    default: false
  },
  isViewed: {
    type: Boolean,
    default: false
  },
  viewedAt: {
    type: Date,
    required: false
  },
  actionUrl: {
    type: String,
    required: false
  }
}, {
  timestamps: true
});

// Index for efficient queries
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1, isRead: 1 });

// Static method to get notifications for a user
notificationSchema.statics.getUserNotifications = function(userId, limit = 50, skip = 0) {
  return this.find({ recipient: userId })
    .populate('sender', 'email')
    .populate('media', 'fileName filePath fileType originalName')
    .populate('folder', 'name')
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip);
};

// Static method to get unread count
notificationSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({ recipient: userId, isRead: false });
};

// Instance method to mark as read
notificationSchema.methods.markAsRead = function() {
  this.isRead = true;
  return this.save();
};

// Instance method to mark as viewed (for view-once media)
notificationSchema.methods.markAsViewed = function() {
  this.isViewed = true;
  this.viewedAt = new Date();
  return this.save();
};

// Static method to create media sharing notification
notificationSchema.statics.createMediaShareNotification = function(data) {
  const {
    recipientId,
    senderId,
    mediaId,
    folderId,
    viewOnce = false,
    scheduledFor = null,
    expiresAt = null,
    personalMessage = null
  } = data;

  const title = viewOnce ? '🔒 View-Once Media Shared' : '📤 Media Shared';
  const message = personalMessage || 
    (viewOnce ? 'You have received a view-once media file' : 'You have received a shared media file');

  console.log('Creating notification with data:', {
    recipientId,
    senderId,
    mediaId,
    folderId,
    viewOnce,
    title,
    message
  });

  return this.create({
    recipient: recipientId,
    sender: senderId,
    type: viewOnce ? 'media_view_once' : 'media_shared',
    title,
    message,
    media: mediaId,
    folder: folderId,
    viewOnce,
    scheduledFor,
    expiresAt,
    actionUrl: `/dashboard/media/${mediaId}`
  });
};

module.exports = mongoose.model('Notification', notificationSchema);
