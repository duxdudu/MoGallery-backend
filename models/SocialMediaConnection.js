const mongoose = require('mongoose');

const socialMediaConnectionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  platform: {
    type: String,
    enum: ['instagram', 'facebook'],
    required: true
  },
  // OAuth tokens
  accessToken: {
    type: String,
    required: true
  },
  refreshToken: {
    type: String
  },
  tokenExpiresAt: {
    type: Date
  },
  // Platform-specific IDs
  platformUserId: {
    type: String,
    required: true
  },
  platformUsername: {
    type: String
  },
  platformProfilePicture: {
    type: String
  },
  // Sync settings
  autoSync: {
    type: Boolean,
    default: true
  },
  lastSyncAt: {
    type: Date
  },
  lastPostId: {
    type: String // Track last synced post to avoid duplicates
  },
  // Special folder for memories (auto-created)
  memoriesFolder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder'
  },
  // Connection status
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient queries
socialMediaConnectionSchema.index({ user: 1, platform: 1 });
socialMediaConnectionSchema.index({ user: 1, isActive: 1 });

// Update timestamp on save
socialMediaConnectionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('SocialMediaConnection', socialMediaConnectionSchema);

