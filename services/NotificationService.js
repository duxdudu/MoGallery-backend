const Notification = require('../models/Notification');
const ViewOnceNotification = require('../models/ViewOnceNotification');
const Media = require('../models/Media');
const Folder = require('../models/Folder');
const User = require('../models/User');

class NotificationService {
  /**
   * Create a professional view-once notification
   */
  static async createViewOnceNotification(data) {
    const {
      recipientId,
      senderId,
      mediaId,
      folderId,
      personalMessage,
      expiresInHours = 24
    } = data;

    try {
      // Get media details for preview
      const media = await Media.findById(mediaId);
      if (!media) {
        throw new Error('Media not found');
      }

      // Get folder details
      const folder = await Folder.findById(folderId);
      if (!folder) {
        throw new Error('Folder not found');
      }

      // Get sender details
      const sender = await User.findById(senderId);
      if (!sender) {
        throw new Error('Sender not found');
      }

      // Create media preview
      const mediaPreview = {
        thumbnailUrl: media.filePath,
        fileType: media.fileType,
        fileName: media.originalName || media.fileName,
        fileSize: media.size || 0
      };

      // Create view-once notification
      const viewOnceNotification = await ViewOnceNotification.createViewOnceNotification({
        recipientId,
        senderId,
        mediaId,
        folderId,
        personalMessage,
        mediaPreview,
        expiresInHours
      });

      // Also create a regular notification for the notification center
      const regularNotification = await Notification.createMediaShareNotification({
        recipientId,
        senderId,
        mediaId,
        folderId,
        viewOnce: true,
        personalMessage,
        expiresAt: viewOnceNotification.expiresAt
      });

      return {
        viewOnceNotification,
        regularNotification,
        mediaPreview
      };
    } catch (error) {
      console.error('Error creating view-once notification:', error);
      throw error;
    }
  }

  /**
   * Get professional notifications for user
   */
  static async getProfessionalNotifications(userId, options = {}) {
    const {
      limit = 50,
      includeViewed = false,
      includeExpired = false
    } = options;

    try {
      // Get regular notifications
      const regularNotifications = await Notification.getUserNotifications(userId, limit);
      
      // Get view-once notifications
      const viewOnceNotifications = await ViewOnceNotification.getActiveNotifications(userId, limit);
      
      // Get unread count
      const unreadCount = await Notification.getUnreadCount(userId);

      // Format notifications for frontend
      const formattedNotifications = [
        ...regularNotifications.map(notif => this.formatRegularNotification(notif)),
        ...viewOnceNotifications.map(notif => this.formatViewOnceNotification(notif))
      ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return {
        notifications: formattedNotifications,
        unreadCount,
        total: formattedNotifications.length
      };
    } catch (error) {
      console.error('Error getting professional notifications:', error);
      throw error;
    }
  }

  /**
   * Format regular notification for frontend
   */
  static formatRegularNotification(notification) {
    return {
      id: notification._id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      sender: notification.sender,
      media: notification.media,
      folder: notification.folder,
      isRead: notification.isRead,
      isViewed: notification.isViewed,
      viewOnce: notification.viewOnce,
      createdAt: notification.createdAt,
      actionUrl: notification.actionUrl,
      isViewOnceNotification: false
    };
  }

  /**
   * Format view-once notification for frontend
   */
  static formatViewOnceNotification(notification) {
    return {
      id: notification._id,
      type: 'media_view_once',
      title: notification.title,
      message: notification.message,
      sender: notification.sender,
      media: notification.media,
      folder: notification.folder,
      isRead: false,
      isViewed: notification.isViewed,
      viewOnce: true,
      createdAt: notification.createdAt,
      actionUrl: `/dashboard/media/${notification.media._id}?viewOnce=true&notificationId=${notification._id}`,
      isViewOnceNotification: true,
      mediaPreview: notification.mediaPreview,
      expiresAt: notification.expiresAt,
      viewCount: notification.viewCount
    };
  }

  /**
   * Mark view-once notification as viewed
   */
  static async markViewOnceAsViewed(notificationId, userId, deviceInfo = null) {
    try {
      const notification = await ViewOnceNotification.findOne({
        _id: notificationId,
        recipient: userId,
        isActive: true
      });

      if (!notification) {
        throw new Error('View-once notification not found');
      }

      if (notification.isViewed) {
        throw new Error('Notification already viewed');
      }

      // Mark as viewed
      await notification.markAsViewed(deviceInfo);

      // Hide the media from the user
      await Media.findByIdAndUpdate(notification.media, {
        $addToSet: { isHiddenFor: userId }
      });

      // Deactivate the notification
      await notification.deactivate();

      return {
        success: true,
        message: 'View-once notification marked as viewed',
        notificationId: notification._id
      };
    } catch (error) {
      console.error('Error marking view-once as viewed:', error);
      throw error;
    }
  }

  /**
   * Cleanup expired notifications
   */
  static async cleanupExpiredNotifications() {
    try {
      // Cleanup expired view-once notifications
      const viewOnceResult = await ViewOnceNotification.cleanupExpired();
      
      // Cleanup old regular notifications (older than 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const regularResult = await Notification.deleteMany({
        createdAt: { $lt: thirtyDaysAgo },
        isRead: true
      });

      return {
        viewOnceCleaned: viewOnceResult.modifiedCount,
        regularCleaned: regularResult.deletedCount
      };
    } catch (error) {
      console.error('Error cleaning up notifications:', error);
      throw error;
    }
  }

  /**
   * Get notification statistics
   */
  static async getNotificationStats(userId) {
    try {
      const totalNotifications = await Notification.countDocuments({ recipient: userId });
      const unreadNotifications = await Notification.countDocuments({ 
        recipient: userId, 
        isRead: false 
      });
      const viewOnceNotifications = await ViewOnceNotification.countDocuments({ 
        recipient: userId, 
        isActive: true 
      });
      const viewedNotifications = await ViewOnceNotification.countDocuments({ 
        recipient: userId, 
        isViewed: true 
      });

      return {
        total: totalNotifications,
        unread: unreadNotifications,
        viewOnce: viewOnceNotifications,
        viewed: viewedNotifications
      };
    } catch (error) {
      console.error('Error getting notification stats:', error);
      throw error;
    }
  }
}

module.exports = NotificationService;

