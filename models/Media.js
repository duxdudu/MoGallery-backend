const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema({
  fileName: {
    type: String,
    required: true,
    trim: true
  },
  filePath: {
    type: String,
    required: true
  },
  cloudinaryId: {
    type: String,
    required: true
  },
  // File size in bytes (set at upload time)
  size: {
    type: Number,
    default: 0
  },
  fileType: {
    type: String,
    enum: ['image', 'video'],
    required: true
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  folder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    required: true
  },
  // Snapchat-style view-once system
  viewOnce: {
    type: {
      enabled: { type: Boolean, default: false },
      sharedWith: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        viewed: { type: Boolean, default: false },
        viewedAt: Date
      }]
    },
    default: {
      enabled: false,
      sharedWith: []
    }
  },
  // Legacy hidden system (kept for backward compatibility)
  isHiddenFor: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Metadata for social media posts
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // Encryption metadata for end-to-end encrypted files
  encryption: {
    encrypted: {
      type: Boolean,
      default: false
    },
    iv: {
      type: String, // Base64 encoded IV
      required: function() { return this.encryption?.encrypted; }
    },
    originalName: {
      type: String,
      required: function() { return this.encryption?.encrypted; }
    },
    originalType: {
      type: String, // Original MIME type
      required: function() { return this.encryption?.encrypted; }
    },
    keyId: {
      type: String,
      default: 'masterKey'
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for better query performance
mediaSchema.index({ folder: 1, owner: 1 });
mediaSchema.index({ 'viewOnce.enabled': 1, 'viewOnce.sharedWith.user': 1 });
mediaSchema.index({ 'isHiddenFor': 1 });

// Normalize legacy documents where viewOnce was stored as a boolean
mediaSchema.post('init', function(doc) {
  try {
    const data = doc;
    if (data) {
      if (typeof data.viewOnce === 'boolean') {
        data.viewOnce = { enabled: data.viewOnce, sharedWith: [] };
      } else if (data.viewOnce == null) {
        data.viewOnce = { enabled: false, sharedWith: [] };
      } else {
        // Ensure structure is complete
        if (typeof data.viewOnce.enabled !== 'boolean') {
          data.viewOnce.enabled = !!data.viewOnce.enabled;
        }
        if (!Array.isArray(data.viewOnce.sharedWith)) {
          data.viewOnce.sharedWith = [];
        }
      }

      if (!Array.isArray(data.isHiddenFor)) {
        data.isHiddenFor = [];
      }
    }
  } catch (_) { /* no-op safeguard */ }
});

// Instance methods
mediaSchema.methods.canView = function(userId) {
  // Check if user is hidden
  if (this.isHiddenFor && this.isHiddenFor.some(id => id.toString() === userId.toString())) {
    return false;
  }
  
  // If view-once is enabled, check if user is in shared list and hasn't viewed
  if (this.viewOnce && this.viewOnce.enabled && this.viewOnce.sharedWith) {
    const shareEntry = this.viewOnce.sharedWith.find(
      entry => entry.user.toString() === userId.toString()
    );
    if (!shareEntry || shareEntry.viewed) {
      return false;
    }
  }
  
  return true;
};

mediaSchema.methods.canEdit = function(userId) {
  return this.owner.toString() === userId.toString();
};

mediaSchema.methods.canDelete = function(userId) {
  return this.owner.toString() === userId.toString();
};

mediaSchema.methods.markAsViewed = function(userId) {
  if (this.viewOnce && this.viewOnce.enabled && this.viewOnce.sharedWith) {
    const shareEntry = this.viewOnce.sharedWith.find(
      entry => entry.user.toString() === userId.toString()
    );
    if (shareEntry && !shareEntry.viewed) {
      shareEntry.viewed = true;
      shareEntry.viewedAt = new Date();
      return this.save();
    }
  }
  return Promise.resolve(this);
};

mediaSchema.methods.addViewOnceUser = function(userId) {
  if (!this.viewOnce.sharedWith || !this.viewOnce.sharedWith.some(entry => entry.user.toString() === userId.toString())) {
    if (!this.viewOnce.sharedWith) this.viewOnce.sharedWith = [];
    this.viewOnce.sharedWith.push({
      user: userId,
      viewed: false
    });
    return this.save();
  }
  return Promise.resolve(this);
};

mediaSchema.methods.removeViewOnceUser = function(userId) {
  if (this.viewOnce.sharedWith) {
    this.viewOnce.sharedWith = this.viewOnce.sharedWith.filter(
      entry => entry.user.toString() !== userId.toString()
    );
    return this.save();
  }
  return Promise.resolve(this);
};

mediaSchema.methods.hideFromUser = function(userId) {
  if (!this.isHiddenFor) this.isHiddenFor = [];
  if (!this.isHiddenFor.some(id => id.toString() === userId.toString())) {
    this.isHiddenFor.push(userId);
    return this.save();
  }
  return Promise.resolve(this);
};

mediaSchema.methods.unhideFromUser = function(userId) {
  if (this.isHiddenFor) {
    this.isHiddenFor = this.isHiddenFor.filter(id => id.toString() !== userId.toString());
    return this.save();
  }
  return Promise.resolve(this);
};

mediaSchema.methods.getViewOnceStatus = function(userId) {
  if (!this.viewOnce || !this.viewOnce.enabled || !this.viewOnce.sharedWith) return null;
  
  const shareEntry = this.viewOnce.sharedWith.find(
    entry => entry.user.toString() === userId.toString()
  );
  
  if (!shareEntry) return null;
  
  return {
    canView: !shareEntry.viewed,
    viewed: shareEntry.viewed,
    viewedAt: shareEntry.viewedAt
  };
};

// Static method to get view-once media for a user
mediaSchema.statics.getViewOnceMedia = function(userId) {
  return this.find({
    'viewOnce.enabled': true,
    'viewOnce.sharedWith.user': userId,
    'viewOnce.sharedWith.viewed': false
  }).populate('owner', 'email').populate('folder', 'name');
};

// Static method to get expired view-once media (viewed by all)
mediaSchema.statics.getExpiredViewOnceMedia = function() {
  return this.find({
    'viewOnce.enabled': true,
    $expr: {
      $allElementsTrue: {
        $map: {
          input: '$viewOnce.sharedWith',
          as: 'share',
          in: '$$share.viewed'
        }
      }
    }
  });
};

// Pre-save middleware to ensure viewOnce structure exists
mediaSchema.pre('save', function(next) {
  if (!this.viewOnce) {
    this.viewOnce = {
      enabled: false,
      sharedWith: []
    };
  }
  if (!this.isHiddenFor) {
    this.isHiddenFor = [];
  }
  next();
});

// Cleanup expired view-once media (optional: run periodically)
mediaSchema.statics.cleanupExpiredViewOnce = async function() {
  const expired = await this.getExpiredViewOnceMedia();
  for (const media of expired) {
    try {
      // Delete from Cloudinary
      const { cloudinary } = require('../config/cloudinary');
      await cloudinary.uploader.destroy(media.cloudinaryId);
      // Delete from database
      await media.deleteOne();
    } catch (error) {
      console.error('Failed to cleanup expired media:', error);
    }
  }
  return expired.length;
};

module.exports = mongoose.model('Media', mediaSchema);
