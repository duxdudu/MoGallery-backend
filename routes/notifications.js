const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');

// Get user notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, skip = 0 } = req.query;

    const notifications = await Notification.getUserNotifications(userId, parseInt(limit), parseInt(skip));
    const unreadCount = await Notification.getUnreadCount(userId);

    res.json({
      notifications,
      unreadCount,
      total: notifications.length
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ message: 'Failed to get notifications' });
  }
});

// Get unread count
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const unreadCount = await Notification.getUnreadCount(userId);

    res.json({ unreadCount });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ message: 'Failed to get unread count' });
  }
});

// Mark notification as read
router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.id;

    const notification = await Notification.findOne({
      _id: notificationId,
      recipient: userId
    });

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    await notification.markAsRead();

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ message: 'Failed to mark notification as read' });
  }
});

// Mark view-once notification as viewed and delete it
router.put('/:id/view-once-viewed', authenticateToken, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.id;

    console.log(`Marking view-once notification ${notificationId} as viewed for user ${userId}`);

    // Validate notification ID format
    if (!notificationId || !mongoose.Types.ObjectId.isValid(notificationId)) {
      console.log(`Invalid notification ID format: ${notificationId}`);
      return res.status(400).json({ message: 'Invalid notification ID format' });
    }

    // First try to find in ViewOnceNotification collection
    const ViewOnceNotification = require('../models/ViewOnceNotification');
    let viewOnceNotification = await ViewOnceNotification.findOne({
      _id: notificationId,
      recipient: userId,
      isActive: true
    }).populate('media');

    if (viewOnceNotification) {
      // Mark as viewed and deactivate
      await viewOnceNotification.markAsViewed();
      await viewOnceNotification.deactivate();

      // Hide the media from the user
      const Media = require('../models/Media');
      await Media.findByIdAndUpdate(viewOnceNotification.media, {
        $addToSet: { isHiddenFor: userId }
      });

      console.log(`View-once notification ${notificationId} marked as viewed and deactivated`);
      return res.json({ 
        message: 'View-once notification marked as viewed and deleted',
        deleted: true
      });
    }

    // Fallback to regular notification
    const notification = await Notification.findOne({
      _id: notificationId,
      recipient: userId
    }).populate('media');

    if (!notification) {
      console.log(`Notification ${notificationId} not found for user ${userId}`);
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Mark as viewed
    await notification.markAsViewed();

    // If it's view-once media, hide it and delete the notification
    if (notification.viewOnce && notification.media) {
      const Media = require('../models/Media');
      await Media.findByIdAndUpdate(notification.media, {
        $addToSet: { isHiddenFor: userId }
      });
      
      // Delete the notification after viewing
      await Notification.findByIdAndDelete(notificationId);
      
      console.log(`View-once notification ${notificationId} marked as viewed and deleted`);
      return res.json({ 
        message: 'View-once notification marked as viewed and deleted',
        deleted: true
      });
    }

    res.json({ message: 'Notification marked as viewed' });
  } catch (error) {
    console.error('Error marking view-once notification as viewed:', error);
    res.status(500).json({ 
      message: 'Failed to mark notification as viewed',
      error: error.message 
    });
  }
});

// Mark notification as viewed (for view-once media)
router.put('/:id/viewed', authenticateToken, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user.id;

    console.log(`Attempting to mark notification ${notificationId} as viewed for user ${userId}`);

    // Validate notification ID format
    if (!notificationId || !mongoose.Types.ObjectId.isValid(notificationId)) {
      console.log(`Invalid notification ID format: ${notificationId}`);
      return res.status(400).json({ message: 'Invalid notification ID format' });
    }

    const notification = await Notification.findOne({
      _id: notificationId,
      recipient: userId
    }).populate('media');

    if (!notification) {
      console.log(`Notification ${notificationId} not found for user ${userId}`);
      return res.status(404).json({ message: 'Notification not found' });
    }

    console.log(`Found notification:`, {
      id: notification._id,
      type: notification.type,
      viewOnce: notification.viewOnce,
      media: notification.media ? notification.media._id : 'No media',
      isViewed: notification.isViewed
    });

    // Mark as viewed
    console.log('Marking notification as viewed...');
    await notification.markAsViewed();
    console.log('Notification marked as viewed successfully');

    // If it's view-once media, hide it from the media list
    if (notification.viewOnce && notification.media) {
      try {
        console.log('Hiding view-once media...');
        const Media = require('../models/Media');
        const mediaId = notification.media._id || notification.media;
        await Media.findByIdAndUpdate(mediaId, {
          $addToSet: { isHiddenFor: userId }
        });
        console.log(`Media ${mediaId} hidden for user ${userId}`);
      } catch (mediaError) {
        console.error('Error hiding media:', mediaError);
        // Don't fail the entire request if media hiding fails
      }
    }

    res.json({ message: 'Notification marked as viewed' });
  } catch (error) {
    console.error('Mark notification as viewed error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Failed to mark notification as viewed',
      error: error.message,
      stack: error.stack
    });
  }
});

// Mark all notifications as read
router.put('/mark-all-read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

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

    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      recipient: userId
    });

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ message: 'Failed to delete notification' });
  }
});

// Cleanup viewed notifications (for view-once media)
router.delete('/cleanup/viewed', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Delete notifications that have been viewed and are view-once
    const result = await Notification.deleteMany({
      recipient: userId,
      viewOnce: true,
      isViewed: true
    });

    console.log(`Cleaned up ${result.deletedCount} viewed notifications for user ${userId}`);

    res.json({ 
      message: 'Viewed notifications cleaned up',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Cleanup viewed notifications error:', error);
    res.status(500).json({ message: 'Failed to cleanup viewed notifications' });
  }
});

// Get shared media notifications (for dashboard)
router.get('/shared-media', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20 } = req.query;

    console.log(`Getting shared media notifications for user: ${userId}`);

    const notifications = await Notification.find({
      recipient: userId,
      type: { $in: ['media_shared', 'media_view_once'] },
      isViewed: false  // Only show notifications that haven't been viewed yet
    })
    .populate('sender', 'email')
    .populate('media', 'fileName filePath fileType originalName')
    .populate('folder', 'name')
    .sort({ createdAt: -1 })
    .limit(parseInt(limit));

    console.log(`Found ${notifications.length} notifications for user ${userId}`);

    // Filter out notifications for media/folders that no longer exist; allow view-once even if folder access revoked
    const validNotifications = [];
    const Folder = require('../models/Folder');
    const Media = require('../models/Media');
    
    for (const notification of notifications) {
      let isValid = true;
      
      if (notification.media && notification.folder) {
        try {
          const media = await Media.findById(notification.media._id);
          const folder = await Folder.findById(notification.folder._id);
          
          if (!media || !folder) {
            console.log(`Removing notification ${notification._id} - media or folder not found`);
            await Notification.findByIdAndDelete(notification._id);
            isValid = false;
          } else {
            const isViewOnceNotification = notification.type === 'media_view_once' || notification.viewOnce === true;
            if (!isViewOnceNotification && !folder.hasAccess(userId)) {
              console.log(`Removing notification ${notification._id} - user no longer has folder access`);
              await Notification.findByIdAndDelete(notification._id);
              isValid = false;
            }
            if (isValid && !media.canView(userId)) {
              console.log(`Removing notification ${notification._id} - user can no longer view media`);
              await Notification.findByIdAndDelete(notification._id);
              isValid = false;
            }
          }
        } catch (error) {
          console.error(`Error checking notification ${notification._id}:`, error);
          // Keep the notification if we can't check it
        }
      }
      
      if (isValid) {
        validNotifications.push(notification);
      }
    }
    
    console.log(`After cleanup: ${validNotifications.length} valid notifications for user ${userId}`);

    res.json({ notifications: validNotifications });
  } catch (error) {
    console.error('Get shared media notifications error:', error);
    res.status(500).json({ 
      message: 'Failed to get shared media notifications',
      error: error.message 
    });
  }
});

module.exports = router;
