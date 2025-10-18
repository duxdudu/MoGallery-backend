const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  // For text documents
  content: {
    type: String,
    default: '',
  },
  tags: {
    type: [String],
    default: [],
    index: true,
  },
  wordCount: {
    type: Number,
    default: 0,
  },
  characterCount: {
    type: Number,
    default: 0,
  },
  // For uploaded files
  fileUrl: {
    type: String,
  },
  fileType: {
    type: String,
  },
  // File size in bytes for uploaded documents (set at upload time)
  size: {
    type: Number,
    default: 0
  },
  thumbnail: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

documentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  if (typeof this.content === 'string') {
    const text = this.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    this.characterCount = text.length;
    this.wordCount = text ? text.split(' ').length : 0;
  }
  next();
});

module.exports = mongoose.model('Document', documentSchema);


