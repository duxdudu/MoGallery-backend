const Media = require('../models/Media');

/**
 * Compute total used bytes for a user across media and documents.
 * Returns a Number (bytes).
 */
async function getUserUsedBytes(userId) {
  const mongoose = require('mongoose');
  const userObjId = mongoose.Types.ObjectId(userId);

  // Sum media sizes
  const mediaAgg = await Media.aggregate([
    { $match: { owner: userObjId } },
    { $group: { _id: null, totalBytes: { $sum: { $ifNull: ['$size', 0] } } } }
  ]);
  const mediaBytes = (mediaAgg[0] && mediaAgg[0].totalBytes) ? mediaAgg[0].totalBytes : 0;

  // Try to include Document sizes if model exists
  let documentBytes = 0;
  try {
    const Document = require('../models/Document');
    const docAgg = await Document.aggregate([
      { $match: { owner: userObjId, size: { $exists: true } } },
      { $group: { _id: null, totalBytes: { $sum: { $ifNull: ['$size', 0] } } } }
    ]);
    documentBytes = (docAgg[0] && docAgg[0].totalBytes) ? docAgg[0].totalBytes : 0;
  } catch (err) {
    documentBytes = 0;
  }

  return mediaBytes + documentBytes;
}

/**
 * Check if adding newBytes would exceed user's storage limit.
 * Returns an object { allowed: boolean, remainingBytes: number|null, limitBytes: number|null }
 */
async function wouldExceedLimit(userId, newBytes, userLimitMB) {
  // userLimitMB can be null meaning unlimited
  if (userLimitMB == null) {
    return { allowed: true, remainingBytes: null, limitBytes: null };
  }
  const used = await getUserUsedBytes(userId);
  const limitBytes = Number(userLimitMB) * 1024 * 1024;
  const remaining = Math.max(0, limitBytes - used);
  const allowed = newBytes <= remaining;
  return { allowed, remainingBytes: remaining, limitBytes };
}

module.exports = { getUserUsedBytes, wouldExceedLimit };
