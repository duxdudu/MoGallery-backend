const mongoose = require('mongoose');

const deviceUsageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  deviceType: {
    type: String,
    enum: ['Mobile', 'Desktop', 'Tablet'],
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  userAgent: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Index for efficient queries
deviceUsageSchema.index({ userId: 1, timestamp: -1 });
deviceUsageSchema.index({ deviceType: 1, timestamp: -1 });

module.exports = mongoose.model('DeviceUsage', deviceUsageSchema);

