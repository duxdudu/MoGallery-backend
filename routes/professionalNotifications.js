const express = require('express');
const router = express.Router();
const NotificationService = require('../services/NotificationService');
const { authenticateToken } = require('../middleware/auth');

// Get professional notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, includeViewed = false, includeExpired = false } = req.query;

    const notifications = await NotificationService.getProfessionalNotifications(userId, {
      limit: parseInt(limit),
      includeViewed: includeViewed === 'true',
      includeExpired: includeExpired === 'true'
    });

    res.json(notifications);
  } catch (error) {
    console.error('Get professional notifications error:', error);
    res.status(500).json({ message: 'Failed to get notifications' });
  }
});

// Create view-once notification
router.post('/view-once', authenticateToken, async (req, res) => {
  try {
    const {
      recipientId,
      mediaId,
      folderId,
      personalMessage,
      expiresInHours = 24
    } = req.body;

    const senderId = req.user.id;

    const result = await NotificationService.createViewOnceNotification({
      recipientId,
      senderId,
      mediaId,
      folderId,
      personalMessage,
      expiresInHours
    });

    res.status(201).json({
      message: 'View-once notification created successfully',
      notification: result.viewOnceNotification,
      mediaPreview: result.mediaPreview
    });
  } catch (error) {
    console.error('Create view-once notification error:', error);
    res.status(500).json({ 
      message: 'Failed to create view-once notification',
      error: error.message 
    });
  }
});

// Mark view-once notification as viewed
router.put('/view-once/:id/viewed', authenticateToken, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.id;
    const deviceInfo = {
      deviceInfo: req.headers['user-agent'] || 'Unknown',
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'] || 'Unknown'
    };

    const result = await NotificationService.markViewOnceAsViewed(
      notificationId, 
      userId, 
      deviceInfo
    );

    res.json(result);
  } catch (error) {
    console.error('Mark view-once as viewed error:', error);
    res.status(500).json({ 
      message: 'Failed to mark notification as viewed',
      error: error.message 
    });
  }
});

// Get notification statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const stats = await NotificationService.getNotificationStats(userId);

    res.json(stats);
  } catch (error) {
    console.error('Get notification stats error:', error);
    res.status(500).json({ message: 'Failed to get notification statistics' });
  }
});

// Cleanup expired notifications
router.post('/cleanup', authenticateToken, async (req, res) => {
  try {
    const result = await NotificationService.cleanupExpiredNotifications();

    res.json({
      message: 'Notifications cleaned up successfully',
      ...result
    });
  } catch (error) {
    console.error('Cleanup notifications error:', error);
    res.status(500).json({ message: 'Failed to cleanup notifications' });
  }
});

// Get media preview for notification
router.get('/media-preview/:mediaId', authenticateToken, async (req, res) => {
  try {
    const mediaId = req.params.mediaId;
    const Media = require('../models/Media');
    
    const media = await Media.findById(mediaId);
    if (!media) {
      return res.status(404).json({ message: 'Media not found' });
    }

    const preview = {
      id: media._id,
      fileName: media.originalName || media.fileName,
      fileType: media.fileType,
      filePath: media.filePath,
      size: media.size || 0,
      thumbnailUrl: media.filePath, // In production, generate actual thumbnail
      createdAt: media.createdAt
    };

    res.json({ preview });
  } catch (error) {
    console.error('Get media preview error:', error);
    res.status(500).json({ message: 'Failed to get media preview' });
  }
});

// Bulk mark notifications as read
router.put('/mark-all-read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const Notification = require('../models/Notification');

    await Notification.updateMany(
      { recipient: userId, isRead: false },
      { isRead: true }
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({ message: 'Failed to mark all notifications as read' });
  }
});

// Delete notification
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.id;
    const Notification = require('../models/Notification');
    const ViewOnceNotification = require('../models/ViewOnceNotification');

    // Try to delete from regular notifications
    let deleted = await Notification.findOneAndDelete({
      _id: notificationId,
      recipient: userId
    });

    // If not found in regular notifications, try view-once notifications
    if (!deleted) {
      deleted = await ViewOnceNotification.findOneAndDelete({
        _id: notificationId,
        recipient: userId
      });
    }

    if (!deleted) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ message: 'Failed to delete notification' });
  }
});

module.exports = router;

