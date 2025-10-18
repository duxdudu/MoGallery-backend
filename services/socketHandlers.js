const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Media = require('../models/Media');
const Document = require('../models/Document');

module.exports = function(io) {
  if (!io) return;

  io.on('connection', async (socket) => {
    // Try to authenticate from cookie (if socket handshake includes cookies) or token in handshake auth
    const token = socket.handshake.auth?.token || (socket.handshake.headers && socket.handshake.headers.cookie && (() => {
      const match = socket.handshake.headers.cookie.match(/mogallery_token=([^;]+)/);
      return match ? match[1] : null;
    })());

    let user = null;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        user = await User.findById(decoded.userId).select('-password -otp -otpExpires');
      } catch (e) {
        // ignore
      }
    }

    // Join a personal room if authenticated
    if (user) {
      socket.join(`user:${user._id}`);
      socket.user = user;
    }

    // Handle live share from clients (share media/document quickly without hitting REST endpoint)
    socket.on('live:share', async (data) => {
      // data: { type: 'media'|'document', id, toUserIds: [..], message? }
      try {
        // Broadcast to recipients' rooms for instant delivery
        if (Array.isArray(data.toUserIds)) {
          data.toUserIds.forEach(uid => io.to(`user:${uid}`).emit('live:share', { from: socket.user ? socket.user._id : null, ...data }));
        }
        // Optionally persist an entry (not required for immediacy). Persisting can be deferred to a background job.
      } catch (err) {
        console.error('Error in live:share handler', err);
      }
    });

    // Handle view-once notification when a client views a media/document
    socket.on('viewonce:viewed', async (data) => {
      // data: { mediaId } or { documentId }
      try {
        if (data.mediaId) {
          // Update media view-once record atomically to mark as viewed by this user
          // Implement efficient scalable logic: use an indexed 'viewOnceViews' subdocument or separate collection
          await Media.updateOne({ _id: data.mediaId, 'viewOnce.viewed': { $ne: true } }, { $set: { 'viewOnce.viewed': true, 'viewOnce.viewedBy': socket.user ? socket.user._id : null, 'viewOnce.viewedAt': new Date() } });
          // Broadcast to owner/room
          const media = await Media.findById(data.mediaId).select('owner');
          if (media && media.owner) io.to(`user:${media.owner}`).emit('viewonce:viewed', { mediaId: data.mediaId, viewer: socket.user ? socket.user._id : null });
        } else if (data.documentId) {
          await Document.updateOne({ _id: data.documentId, 'viewOnce.viewed': { $ne: true } }, { $set: { 'viewOnce.viewed': true, 'viewOnce.viewedBy': socket.user ? socket.user._id : null, 'viewOnce.viewedAt': new Date() } });
          const doc = await Document.findById(data.documentId).select('owner');
          if (doc && doc.owner) io.to(`user:${doc.owner}`).emit('viewonce:viewed', { documentId: data.documentId, viewer: socket.user ? socket.user._id : null });
        }
      } catch (err) {
        console.error('Error handling viewonce:viewed', err);
      }
    });

    socket.on('disconnect', () => {
      // cleanup
    });
  });
};
