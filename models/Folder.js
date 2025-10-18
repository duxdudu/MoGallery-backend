const mongoose = require('mongoose');

const folderSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sharedWith: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    permission: { type: String, enum: ['view', 'upload'], default: 'view' }
  }],
  // View-once sharing system for folders
  viewOnce: {
    enabled: { type: Boolean, default: false },
    sharedWith: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      viewed: { type: Boolean, default: false },
      viewedAt: Date
    }]
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

// Update timestamp on save
folderSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Method to check if user has access to folder
folderSchema.methods.hasAccess = function(userId) {
  // Owner can always access
  if (this.owner.toString() === userId.toString()) {
    return true;
  }
  
  // Check if user is in regular shared list
  const regularShare = this.sharedWith.find(share => 
    share.user && share.user.toString() === userId.toString()
  );
  if (regularShare) {
    return true;
  }
  
  // Check view-once sharing
  if (this.viewOnce && this.viewOnce.enabled && this.viewOnce.sharedWith) {
    const shareEntry = this.viewOnce.sharedWith.find(
      entry => entry.user && entry.user.toString() === userId.toString()
    );
    if (shareEntry && !shareEntry.viewed) {
      return true;
    }
  }
  
  return false;
};

// Method to check if user is owner
folderSchema.methods.isOwner = function(userId) {
  return this.owner.toString() === userId.toString();
};

// Method to check if user can edit (owner only)
folderSchema.methods.canEdit = function(userId) {
  return this.owner.toString() === userId.toString();
};

// Method to check if user can upload (owner or upload permission)
folderSchema.methods.canUpload = function(userId) {
  if (this.owner.toString() === userId.toString()) {
    return true;
  }
  const share = this.sharedWith.find(share => share.user.toString() === userId.toString());
  return share && share.permission === 'upload';
};

// Method to check if user can delete (owner only)
folderSchema.methods.canDelete = function(userId) {
  return this.owner.toString() === userId.toString();
};

// Method to check if user can share (owner only)
folderSchema.methods.canShare = function(userId) {
  return this.owner.toString() === userId.toString();
};

// View-once methods
folderSchema.methods.canViewFolder = function(userId) {
  // Owner can always view
  if (this.owner.toString() === userId.toString()) {
    return true;
  }
  
  // Check if user is in regular shared list
  const regularShare = this.sharedWith.find(share => 
    share.user && share.user.toString() === userId.toString()
  );
  if (regularShare) {
    return true;
  }
  
  // Check view-once sharing
  if (this.viewOnce && this.viewOnce.enabled && this.viewOnce.sharedWith) {
    const shareEntry = this.viewOnce.sharedWith.find(
      entry => entry.user && entry.user.toString() === userId.toString()
    );
    if (shareEntry && !shareEntry.viewed) {
      return true;
    }
  }
  
  return false;
};

folderSchema.methods.markFolderAsViewed = function(userId) {
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

folderSchema.methods.addViewOnceUser = function(userId) {
  if (!this.viewOnce) {
    this.viewOnce = { enabled: false, sharedWith: [] };
  }
  
  if (!this.viewOnce.sharedWith.some(entry => entry.user.toString() === userId.toString())) {
    this.viewOnce.sharedWith.push({
      user: userId,
      viewed: false
    });
    return this.save();
  }
  return Promise.resolve(this);
};

folderSchema.methods.removeViewOnceUser = function(userId) {
  if (this.viewOnce && this.viewOnce.sharedWith) {
    this.viewOnce.sharedWith = this.viewOnce.sharedWith.filter(
      entry => entry.user.toString() !== userId.toString()
    );
    return this.save();
  }
  return Promise.resolve(this);
};

// Pre-save middleware to ensure viewOnce structure exists
folderSchema.pre('save', function(next) {
  if (!this.viewOnce) {
    this.viewOnce = {
      enabled: false,
      sharedWith: []
    };
  }
  next();
});

module.exports = mongoose.model('Folder', folderSchema);
