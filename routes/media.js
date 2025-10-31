const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { 
  checkMediaViewAccess, 
  checkMediaEditPermission, 
  checkMediaDeletePermission, 
  checkFolderUploadPermission 
} = require('../middleware/mediaPermissions');
const { body, validationResult } = require('express-validator');
const Media = require('../models/Media');
const Folder = require('../models/Folder');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { upload, cloudinary } = require('../config/cloudinary');

// Validation middleware
const validateHideUser = [
  body('userId').isMongoId().withMessage('Valid user ID is required')
];

const validateViewOnce = [
  body('viewOnce').isBoolean().withMessage('viewOnce must be a boolean')
];

// Get all media for the authenticated user
router.get('/all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const media = await Media.find({ owner: userId })
      .populate('folder', 'name _id')
      .populate('owner', 'email')
      .sort({ createdAt: -1 });

    // Filter media based on user permissions
    const accessibleMedia = media.filter(mediaItem => {
      // User can always see their own media
      if (mediaItem.owner._id.toString() === userId.toString()) {
        return true;
      }
      
      // Check if media is hidden from user
      if (mediaItem.isHiddenFor && mediaItem.isHiddenFor.some(id => id.toString() === userId.toString())) {
        return false;
      }
      
      // Check view-once permissions
      if (mediaItem.viewOnce && mediaItem.viewOnce.enabled && mediaItem.viewOnce.sharedWith) {
        const shareEntry = mediaItem.viewOnce.sharedWith.find(
          entry => entry.user.toString() === userId.toString()
        );
        if (!shareEntry || shareEntry.viewed) {
          return false;
        }
      }
      
      return true;
    });

    // Debug folder data
    console.log('Media items with folder data:');
    accessibleMedia.forEach((item, index) => {
      console.log(`Item ${index}:`, {
        id: item._id,
        fileName: item.fileName,
        folder: item.folder,
        folderId: item.folder?._id,
        folderName: item.folder?.name
      });
    });

    res.json({
      message: 'Media retrieved successfully',
      media: accessibleMedia.map(item => {
        let filePath = item.filePath;
        let thumbnailUrl;
        try {
          if (item.fileType === 'video' && item.cloudinaryId) {
            filePath = cloudinary.url(item.cloudinaryId, { resource_type: 'video', secure: true, format: 'mp4' });
            thumbnailUrl = cloudinary.url(item.cloudinaryId, {
              resource_type: 'video',
              secure: true,
              format: 'jpg',
              transformation: [{ width: 640, height: 360, crop: 'fill' }]
            });
          }
        } catch (_) {}
        return ({
          id: item._id,
          fileName: item.fileName,
          filePath,
          thumbnailUrl,
          fileType: item.fileType,
          owner: item.owner,
          folder: item.folder ? {
            id: item.folder._id,
            name: item.folder.name
          } : null,
          viewOnce: item.viewOnce,
          isHiddenFor: item.isHiddenFor,
          createdAt: item.createdAt,
          canEdit: item.canEdit(userId),
          canDelete: item.canDelete(userId)
        });
      })
    });

  } catch (error) {
    console.error('Get all media error:', error);
    res.status(500).json({ message: 'Failed to retrieve media' });
  }
});

// Upload up to 10 media files to a folder using Cloudinary
router.post('/upload/:folderId', 
  authenticateToken, 
  checkFolderUploadPermission,
  (req, res, next) => {
    // Wrap multer to surface validation errors clearly
    const handler = upload.array('media', 10);
    handler(req, res, (err) => {
      if (err) {
        // Normalize multer/cloudinary errors so the frontend can display helpful messages
        const isMulterError = err.name === 'MulterError';
        let status = 400;
        let code = err.code || err.name || 'UPLOAD_ERROR';
        let message = err.message || 'Upload error';

        if (isMulterError) {
          switch (err.code) {
            case 'LIMIT_FILE_SIZE':
              message = 'File too large. Max size is 100MB.';
              break;
            case 'LIMIT_FILE_COUNT':
              message = 'Too many files. You can upload at most 10.';
              break;
            case 'LIMIT_UNEXPECTED_FILE':
              message = 'Unexpected file field. Use "media".';
              break;
            default:
              message = `Upload failed: ${message}`;
          }
        }

        // Some cloudinary/storage errors may come through as generic Error
        if (!isMulterError && code && typeof code === 'string' && code.toLowerCase().includes('cloudinary')) {
          // Validation/config issues from Cloudinary should be considered a bad request (400),
          // but transient Cloudinary outages would be 5xx from their API. Since this is
          // happening before the upload starts (storage params), treat as 400.
          status = 400;
        }

        // Timeouts surface differently depending on layer; expose a clear message and 504
        if (code && typeof code === 'string' && code.toLowerCase().includes('timeout')) {
          status = 504;
          message = message.includes('Timeout') ? message : 'Request Timeout while uploading to cloud storage';
        }

        return res.status(status).json({ message, code });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const files = req.files || [];
      if (!files.length) {
        return res.status(400).json({ message: 'No files uploaded' });
      }

      // Enforce per-user storage limit for the batch upload
      try {
        const { wouldExceedLimit } = require('../utils/storage');
        const User = require('../models/User');
        const user = await User.findById(req.user.id).select('storageLimitMB');
        const userLimitMB = user && user.storageLimitMB != null ? user.storageLimitMB : (process.env.DEFAULT_STORAGE_LIMIT_MB ? Number(process.env.DEFAULT_STORAGE_LIMIT_MB) : null);
        const totalNewBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
        const check = await wouldExceedLimit(req.user.id, totalNewBytes, userLimitMB);
        if (!check.allowed) {
          const remainingMB = +(check.remainingBytes / (1024 * 1024)).toFixed(2);
          return res.status(413).json({ message: `Upload exceeds your storage limit. ${remainingMB} MB remaining.` });
        }
      } catch (limitErr) {
        console.error('Storage limit check failed, allowing upload by default:', limitErr);
      }

      const created = [];
      for (const file of files) {
        const fileType = file.mimetype.startsWith('image/') ? 'image' : 'video';
        const media = new Media({
          fileName: file.originalname,
          filePath: file.path,
          cloudinaryId: file.filename,
          size: file.size || 0,
          fileType,
          owner: req.user.id,
          folder: req.params.folderId
        });
        await media.save();
        created.push(media);
      }

      // Populate minimal owner and folder fields for response consistency
      await Media.populate(created, [
        { path: 'owner', select: 'email' },
        { path: 'folder', select: 'name' }
      ]);

      res.status(201).json({
        success: true,
        message: 'Media uploaded successfully',
        media: created.map((m) => {
          let filePath = m.filePath;
          let thumbnailUrl;
          try {
            if (m.fileType === 'video' && m.cloudinaryId) {
              // Build a reliable streaming URL for video and a poster thumbnail
              filePath = cloudinary.url(m.cloudinaryId, { resource_type: 'video', secure: true, format: 'mp4' });
              thumbnailUrl = cloudinary.url(m.cloudinaryId, {
                resource_type: 'video',
                secure: true,
                format: 'jpg',
                transformation: [{ width: 640, height: 360, crop: 'fill' }]
              });
            }
          } catch (_) {}

          return {
            id: m._id,
            fileName: m.fileName,
            filePath,
            thumbnailUrl,
            fileType: m.fileType,
            owner: m.owner && typeof m.owner === 'object' ? { id: m.owner._id, email: m.owner.email } : m.owner,
            folder: m.folder && typeof m.folder === 'object' ? { id: m.folder._id, name: m.folder.name } : m.folder,
            viewOnce: {
              enabled: m.viewOnce?.enabled || false,
              sharedWith: m.viewOnce?.sharedWith || []
            },
            isHiddenFor: m.isHiddenFor || [],
            createdAt: m.createdAt,
            canEdit: m.canEdit(req.user.id),
            canDelete: m.canDelete(req.user.id)
          };
        })
      });
    } catch (error) {
      // Best-effort cleanup of already-uploaded files if DB save fails mid-way
      if (req.files && Array.isArray(req.files)) {
        for (const f of req.files) {
          if (f && f.filename) {
            try { await cloudinary.uploader.destroy(f.filename); } catch (_) {}
          }
        }
      }
      const status = error.name === 'MongooseError' ? 400 : 500;
      // Add a normalized code to help frontend display better feedback
      const code = error.name || 'UPLOAD_FAILED';
      res.status(status).json({ 
        message: 'Failed to upload media',
        error: error.message,
        code
      });
    }
  }
);

// Test endpoint to check media retrieval
router.get('/test/:folderId', authenticateToken, async (req, res) => {
  try {
    console.log('Test media retrieval for folder:', req.params.folderId);
    
    const media = await Media.find({ folder: req.params.folderId }).limit(1);
    console.log('Found media:', media.length);
    
    res.json({ 
      message: 'Test successful', 
      mediaCount: media.length,
      folderId: req.params.folderId
    });
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({ 
      message: 'Test failed',
      error: error.message 
    });
  }
});

// List media in folder (respecting hidden and view-once rules)
router.get('/folder/:folderId', authenticateToken, async (req, res) => {
  try {
    // Ensure the user has access to the folder to view contents
    const folder = await Folder.findById(req.params.folderId);
    if (!folder) {
      return res.status(404).json({ message: 'Folder not found' });
    }
    if (!folder.hasAccess(req.user.id)) {
      return res.status(403).json({ message: 'Access denied to this folder' });
    }

    const media = await Media.find({ folder: req.params.folderId })
      .populate('owner', 'email')
      .populate('folder', 'name')
      .sort({ createdAt: -1 });

    // Filter media based on user permissions
    const accessibleMedia = media.filter(item => {
      try {
        return item.canView(req.user.id);
      } catch (filterError) {
        console.error('Error filtering media item:', filterError);
        return false;
      }
    });

    res.json({
      message: 'Media retrieved successfully',
      media: accessibleMedia.map(item => {
        let filePath = item.filePath;
        let thumbnailUrl;
        try {
          if (item.fileType === 'video' && item.cloudinaryId) {
            filePath = cloudinary.url(item.cloudinaryId, { resource_type: 'video', secure: true, format: 'mp4' });
            thumbnailUrl = cloudinary.url(item.cloudinaryId, {
              resource_type: 'video',
              secure: true,
              format: 'jpg',
              transformation: [{ width: 640, height: 360, crop: 'fill' }]
            });
          }
        } catch (_) {}
        return ({
          id: item._id,
          fileName: item.fileName,
          filePath,
          thumbnailUrl,
          fileType: item.fileType,
          owner: item.owner ? { id: item.owner._id, email: item.owner.email } : undefined,
          folder: item.folder ? { id: item.folder._id, name: item.folder.name } : undefined,
          viewOnce: {
            enabled: item.viewOnce?.enabled || false,
            sharedWith: item.viewOnce?.sharedWith || []
          },
          isHiddenFor: item.isHiddenFor || [],
          createdAt: item.createdAt,
          canEdit: item.canEdit(req.user.id),
          canDelete: item.canDelete(req.user.id)
        });
      })
    });
  } catch (error) {
    console.error('Media retrieval error:', error);
    res.status(500).json({ 
      message: 'Failed to retrieve media',
      error: error.message 
    });
  }
});

// Get single media metadata (without requiring folder access, but enforcing media view access)
router.get('/:id/meta', 
  authenticateToken, 
  checkMediaViewAccess,
  async (req, res) => {
    try {
      const media = req.media; // set by checkMediaViewAccess
      const populated = await Media.findById(media._id)
        .populate('owner', 'email')
        .populate('folder', 'name');
      if (!populated) {
        return res.status(404).json({ message: 'Media not found' });
      }
      let filePath = populated.filePath;
      let thumbnailUrl;
      try {
        if (populated.fileType === 'video' && populated.cloudinaryId) {
          filePath = cloudinary.url(populated.cloudinaryId, { resource_type: 'video', secure: true, format: 'mp4' });
          thumbnailUrl = cloudinary.url(populated.cloudinaryId, {
            resource_type: 'video',
            secure: true,
            format: 'jpg',
            transformation: [{ width: 640, height: 360, crop: 'fill' }]
          });
        }
      } catch (_) {}

      res.json({
        message: 'Media metadata retrieved successfully',
        media: {
          id: populated._id,
          fileName: populated.fileName,
          filePath,
          thumbnailUrl,
          fileType: populated.fileType,
          owner: populated.owner ? { id: populated.owner._id, email: populated.owner.email } : undefined,
          folder: populated.folder ? { id: populated.folder._id, name: populated.folder.name } : undefined,
          viewOnce: {
            enabled: populated.viewOnce?.enabled || false,
            sharedWith: populated.viewOnce?.sharedWith || []
          },
          isHiddenFor: populated.isHiddenFor || [],
          createdAt: populated.createdAt,
          updatedAt: populated.updatedAt
        }
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to retrieve media metadata', error: error.message });
    }
  }
);

// Hide media from specific user
router.put('/:id/hide', 
  authenticateToken, 
  checkMediaEditPermission,
  validateHideUser,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      await media.hideFromUser(req.body.userId);
      
      res.json({ 
        message: 'Media hidden from user successfully',
        media: {
          id: media._id,
          isHiddenFor: media.isHiddenFor
        }
      });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to hide media',
        error: error.message 
      });
    }
  }
);

// Unhide media from specific user
router.put('/:id/unhide', 
  authenticateToken, 
  checkMediaEditPermission,
  validateHideUser,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      await media.unhideFromUser(req.body.userId);
      
      res.json({ 
        message: 'Media unhidden from user successfully',
        media: {
          id: media._id,
          isHiddenFor: media.isHiddenFor
        }
      });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to unhide media',
        error: error.message 
      });
    }
  }
);

// Toggle view-once mode
router.put('/:id/view-once', 
  authenticateToken, 
  checkMediaEditPermission,
  validateViewOnce,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      media.viewOnce.enabled = req.body.viewOnce;
      
      // Clear sharedWith array if disabling view-once
      if (!req.body.viewOnce) {
        media.viewOnce.sharedWith = [];
      }
      
      await media.save();
      
      res.json({ 
        message: `View-once ${req.body.viewOnce ? 'enabled' : 'disabled'} successfully`,
        media: {
          id: media._id,
          viewOnce: {
            enabled: media.viewOnce.enabled,
            sharedWith: media.viewOnce.sharedWith
          }
        }
      });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to update view-once setting',
        error: error.message 
      });
    }
  }
);

// View media (with view-once logic)
router.get('/:id/view', 
  authenticateToken, 
  checkMediaViewAccess,
  async (req, res) => {
    try {
      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      // Mark as viewed if view-once is enabled
      if (media.viewOnce?.enabled) {
        await media.markAsViewed(req.user.id);
      }

      // Redirect to Cloudinary URL
      res.redirect(media.filePath);
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to view media',
        error: error.message 
      });
    }
  }
);

// Download media (with view-once logic)
router.get('/:id/download', 
  authenticateToken, 
  checkMediaViewAccess,
  async (req, res) => {
    try {
      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      // Mark as viewed if view-once is enabled
      if (media.viewOnce?.enabled) {
        await media.markAsViewed(req.user.id);
      }

      // Redirect to Cloudinary URL for download
      res.redirect(media.filePath);
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to download media',
        error: error.message 
      });
    }
  }
);

// List scheduled operations for a media
router.get('/:id/scheduled-operations',
  authenticateToken,
  checkMediaEditPermission,
  async (req, res) => {
    try {
      const mediaId = req.params.id;
      const userId = req.user.id;

      // Helper to compute status
      const computeStatus = (scheduledFor, expiresAt) => {
        const now = new Date();
        if (expiresAt && new Date(expiresAt) < now) return 'expired';
        if (scheduledFor && new Date(scheduledFor) > now) return 'pending';
        return 'executed';
      };

      // Helper to parse operation from notification message
      const parseOperation = (msg) => {
        if (!msg || typeof msg !== 'string') return 'scheduled';
        const m = msg.match(/Operation\s([a-zA-Z-]+)/i);
        return m && m[1] ? m[1].toLowerCase() : 'scheduled';
      };

      // CRUD operation schedules (self notifications)
      const crudNotifs = await Notification.find({
        media: mediaId,
        type: 'media_scheduled',
        sender: userId,
      }).populate('recipient', 'email').sort({ scheduledFor: 1 });

      const operations = crudNotifs.map(n => ({
        id: n._id.toString(),
        operation: parseOperation(n.message),
        scheduledFor: n.scheduledFor,
        expiresAt: n.expiresAt || null,
        targetUsers: [],
        status: computeStatus(n.scheduledFor, n.expiresAt),
        createdAt: n.createdAt,
      }));

      // View-once scheduled shares initiated by current user (aggregate recipients)
      const voNotifs = await Notification.find({
        media: mediaId,
        type: 'media_view_once',
        sender: userId,
        scheduledFor: { $ne: null },
      }).populate('recipient', 'email').sort({ scheduledFor: 1 });

      const groups = {};
      for (const n of voNotifs) {
        const key = `${n.scheduledFor?.toISOString() || ''}|${n.expiresAt?.toISOString() || ''}`;
        if (!groups[key]) {
          groups[key] = { notifications: [], scheduledFor: n.scheduledFor, expiresAt: n.expiresAt };
        }
        groups[key].notifications.push(n);
      }

      for (const g of Object.values(groups)) {
        const first = g.notifications[0];
        const targetUsers = g.notifications.map(x => x.recipient?.email).filter(Boolean);
        operations.push({
          id: first._id.toString(),
          operation: 'view-once',
          scheduledFor: g.scheduledFor,
          expiresAt: g.expiresAt || null,
          targetUsers,
          status: computeStatus(g.scheduledFor, g.expiresAt),
          createdAt: first.createdAt,
        });
      }

      res.json({ message: 'Scheduled operations fetched', operations });
    } catch (error) {
      console.error('Failed to list scheduled operations:', error);
      res.status(500).json({ message: 'Failed to list scheduled operations', error: error.message });
    }
  }
);

// Execute a scheduled operation immediately (mark as executed)
router.post('/:id/scheduled-operations/:operationId/execute',
  authenticateToken,
  checkMediaEditPermission,
  async (req, res) => {
    try {
      const mediaId = req.params.id;
      const { operationId } = req.params;

      const notif = await Notification.findOne({ _id: operationId, media: mediaId });
      if (!notif) {
        return res.status(404).json({ message: 'Scheduled operation not found' });
      }

      // Mark as executed by setting scheduledFor to now
      const now = new Date();
      notif.scheduledFor = now;
      await notif.save();

      // Infer operation
      const operation = notif.type === 'media_view_once' ? 'view-once' : (notif.type === 'media_scheduled' ? (notif.message ? (notif.message.match(/Operation\s([a-zA-Z-]+)/i)?.[1]?.toLowerCase() || 'scheduled') : 'scheduled') : 'share');

      res.json({
        message: 'Scheduled operation executed',
        operation: {
          id: notif._id.toString(),
          operation,
          scheduledFor: notif.scheduledFor,
          expiresAt: notif.expiresAt || null,
          targetUsers: [],
          status: 'executed',
          createdAt: notif.createdAt,
          executedAt: now,
        }
      });
    } catch (error) {
      console.error('Failed to execute scheduled operation:', error);
      res.status(500).json({ message: 'Failed to execute scheduled operation', error: error.message });
    }
  }
);

// Get download URL (authenticate first, then return Cloudinary URL)
router.get('/:id/download-url', 
  authenticateToken, 
  checkMediaViewAccess,
  async (req, res) => {
    try {
      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      // Mark as viewed if view-once is enabled
      if (media.viewOnce?.enabled) {
        await media.markAsViewed(req.user.id);
      }
      // For Cloudinary assets, use fl_attachment to force download
      let url = media.filePath;
      try {
        if (typeof url === 'string' && url.includes('/upload/')) {
          // Insert fl_attachment/ after /upload/
          url = url.replace('/upload/', '/upload/fl_attachment/');
        } else if (typeof url === 'string' && url.startsWith('http')) {
          // Append download hint as fallback
          const sep = url.includes('?') ? '&' : '?';
          url = `${url}${sep}download=1`;
        }
      } catch (_) {}

      res.json({ url });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to get download URL',
        error: error.message 
      });
    }
  }
);

// Delete media (owner only)
router.delete('/:id', 
  authenticateToken, 
  checkMediaDeletePermission,
  async (req, res) => {
    try {
      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      // Delete from Cloudinary
      if (media.cloudinaryId) {
        try {
          await cloudinary.uploader.destroy(media.cloudinaryId);
        } catch (cloudinaryError) {
          console.error('Failed to delete from Cloudinary:', cloudinaryError);
        }
      }

      // Delete from database
      await Media.findByIdAndDelete(req.params.id);
      
      res.json({ message: 'Media deleted successfully' });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to delete media',
        error: error.message 
      });
    }
  }
);

// Share media with specific users (view-once)
router.post('/:id/share', 
  authenticateToken, 
  checkMediaEditPermission,
  [
    body('userIds').isArray().withMessage('userIds must be an array'),
    body('userIds.*').isMongoId().withMessage('Each userId must be a valid MongoDB ID')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      // Enable view-once and add users
      media.viewOnce.enabled = true;
      for (const userId of req.body.userIds) {
        await media.addViewOnceUser(userId);
      }
      
      await media.populate('viewOnce.sharedWith.user', 'email');

      // Create notifications for each recipient
      try {
        const senderId = req.user.id;
        const folderId = media.folder;
        for (const userId of req.body.userIds) {
          await Notification.createMediaShareNotification({
            recipientId: userId,
            senderId,
            mediaId: media._id,
            folderId,
            viewOnce: true,
          });
        }
      } catch (notifyErr) {
        console.error('Failed to create notifications for media share (userIds):', notifyErr);
      }
      
      res.json({ 
        message: 'Media shared successfully with view-once enabled',
        media: {
          id: media._id,
          viewOnce: {
            enabled: media.viewOnce.enabled,
            sharedWith: media.viewOnce.sharedWith
          }
        }
      });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to share media',
        error: error.message 
      });
    }
  }
);

// Share media directly (new endpoint that doesn't expose folder structure)
router.post('/:id/share-direct', authenticateToken, async (req, res) => {
  try {
    const mediaId = req.params.id;
    const { emails, viewOnce, permission, message, expiresInHours } = req.body;
    const senderId = req.user.id;

    console.log(`Direct sharing media ${mediaId} with emails:`, emails);

    // Validate input
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ message: 'At least one email address is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = emails.filter(email => !emailRegex.test(email));
    if (invalidEmails.length > 0) {
      return res.status(400).json({ 
        message: `Invalid email addresses: ${invalidEmails.join(', ')}` 
      });
    }

    // Get media and verify ownership
    const media = await Media.findById(mediaId).populate('folder');
    if (!media) {
      return res.status(404).json({ message: 'Media not found' });
    }

    if (media.owner.toString() !== senderId) {
      return res.status(403).json({ message: 'You can only share your own media' });
    }

    // Find existing users for the emails; record failures for unknown emails
    const results = [];
    const users = [];
    for (const rawEmail of emails) {
      const email = rawEmail.toLowerCase();
      const user = await User.findOne({ email });
      if (!user) {
        console.warn(`No user found for email: ${email}. Skipping.`);
        results.push({ email, success: false, error: 'User not found' });
        continue;
      }
      users.push(user);
    }

    for (const user of users) {
      try {
        if (viewOnce) {
          // Create view-once notification using the professional notification system
          const NotificationService = require('../services/NotificationService');
          const notification = await NotificationService.createViewOnceNotification({
            recipientId: user._id,
            senderId: senderId,
            mediaId: mediaId,
            folderId: media.folder._id, // Keep folder reference for backend but don't expose to user
            personalMessage: message,
            mediaPreview: {
              thumbnailUrl: media.filePath,
              fileType: media.fileType,
              fileName: media.fileName,
              fileSize: media.size || 0
            },
            expiresInHours: expiresInHours || 24
          });

          results.push({
            email: user.email,
            success: true,
            notificationId: notification._id,
            type: 'view-once'
          });
        } else {
          // Create regular sharing notification
          const notification = new Notification({
            recipient: user._id,
            sender: senderId,
            media: mediaId,
            folder: media.folder._id, // Keep folder reference for backend but don't expose to user
            type: 'media_shared',
            title: '📁 Media Shared',
            message: message || `You have been shared a ${media.fileType} file: ${media.fileName}`,
            viewOnce: false
          });

          await notification.save();

          results.push({
            email: user.email,
            success: true,
            notificationId: notification._id,
            type: 'regular'
          });
        }
      } catch (userError) {
        console.error(`Error sharing with user ${user.email}:`, userError);
        results.push({
          email: user.email,
          success: false,
          error: userError.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    res.json({
      message: `Successfully shared with ${successCount} recipient(s)`,
      results: results,
      successCount,
      failureCount,
      media: {
        id: media._id,
        fileName: media.fileName,
        fileType: media.fileType
      }
    });

  } catch (error) {
    console.error('Direct share error:', error);
    res.status(500).json({ 
      message: 'Failed to share media',
      error: error.message 
    });
  }
});

// Share media with specific users by emails (enables view-once)
router.post('/:id/share-by-email', 
  authenticateToken,
  checkMediaEditPermission,
  [
    body('emails').isArray({ min: 1 }).withMessage('emails must be a non-empty array'),
    body('emails.*').isEmail().withMessage('Each email must be a valid address'),
    body('viewOnce').optional().isBoolean().withMessage('viewOnce must be a boolean'),
    body('permission').optional().isIn(['view', 'upload']).withMessage('permission must be view or upload'),
    body('message').optional().isString().withMessage('message must be a string')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
      }

      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      const emails = req.body.emails.map((e) => e.toLowerCase().trim());
      const users = await User.find({ email: { $in: emails } });

      if (!users.length) {
        return res.status(404).json({ message: 'No users found for the provided emails' });
      }

      // Enable view-once if requested and add each user
      const viewOnce = req.body.viewOnce !== false; // Default to true for backward compatibility
      media.viewOnce.enabled = viewOnce;
      for (const u of users) {
        await media.addViewOnceUser(u._id);
      }

      await media.populate('viewOnce.sharedWith.user', 'email');

      // Create notifications for each recipient
      try {
        const senderId = req.user.id;
        const folderId = media.folder;
        for (const u of users) {
          await Notification.createMediaShareNotification({
            recipientId: u._id,
            senderId,
            mediaId: media._id,
            folderId,
            viewOnce: viewOnce,
            personalMessage: req.body.message
          });
        }
      } catch (notifyErr) {
        // Log but don't fail the share if notifications fail
        console.error('Failed to create notifications for media share:', notifyErr);
      }

      res.json({
        message: 'Media shared by email successfully with view-once enabled',
        sharedCount: users.length,
        media: {
          id: media._id,
          viewOnce: {
            enabled: media.viewOnce.enabled,
            sharedWith: media.viewOnce.sharedWith
          }
        }
      });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to share media by email',
        error: error.message 
      });
    }
  }
);

// Get view-once status for current user
router.get('/:id/view-once-status', 
  authenticateToken, 
  checkMediaViewAccess,
  async (req, res) => {
    try {
      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      const status = media.getViewOnceStatus(req.user.id);
      
      res.json({
        message: 'View-once status retrieved successfully',
        status,
        media: {
          id: media._id,
          viewOnce: {
            enabled: media.viewOnce.enabled,
            sharedWith: media.viewOnce.sharedWith
          }
        }
      });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to get view-once status',
        error: error.message 
      });
    }
  }
);

// Remove user from view-once sharing
router.delete('/:id/share/:userId', 
  authenticateToken, 
  checkMediaEditPermission,
  async (req, res) => {
    try {
      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      await media.removeViewOnceUser(req.params.userId);
      
      res.json({ 
        message: 'User removed from view-once sharing successfully',
        media: {
          id: media._id,
          viewOnce: {
            enabled: media.viewOnce.enabled,
            sharedWith: media.viewOnce.sharedWith
          }
        }
      });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to remove user from sharing',
        error: error.message 
      });
    }
  }
);

// Get all view-once media for current user
router.get('/view-once', authenticateToken, async (req, res) => {
  try {
    const media = await Media.getViewOnceMedia(req.user.id);
    
    res.json({
      message: 'View-once media retrieved successfully',
      media: media.map(item => ({
        id: item._id,
        fileName: item.fileName,
        filePath: item.filePath,
        fileType: item.fileType,
        owner: item.owner ? { id: item.owner._id, email: item.owner.email } : undefined,
        folder: item.folder ? { id: item.folder._id, name: item.folder.name } : undefined,
        viewOnce: {
          enabled: item.viewOnce?.enabled || false,
          sharedWith: item.viewOnce?.sharedWith || []
        },
        createdAt: item.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Failed to retrieve view-once media',
      error: error.message 
    });
  }
});

// Schedule a CRUD operation for media
router.post('/:id/schedule-crud',
  authenticateToken,
  checkMediaEditPermission,
  [
    body('operation').isString().isIn(['create','read','update','delete','share','hide','unhide']).withMessage('Valid operation is required'),
    body('scheduledFor').isISO8601().withMessage('scheduledFor must be an ISO8601 date string'),
    body('expiresAt').optional().isISO8601().withMessage('expiresAt must be an ISO8601 date string')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const media = await Media.findById(req.params.id).populate('folder');
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      const { operation, scheduledFor, expiresAt } = req.body;

      // Create a scheduling notification (self-targeted to the owner)
      const notification = await Notification.create({
        recipient: req.user.id,
        sender: req.user.id,
        type: 'media_scheduled',
        title: '🗓 Media Operation Scheduled',
        message: `Operation ${operation} scheduled for ${new Date(scheduledFor).toLocaleString()}`,
        media: media._id,
        folder: media.folder?._id,
        scheduledFor: new Date(scheduledFor),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        actionUrl: `/dashboard/media/${media._id}`
      });

      res.json({
        message: 'Media operation scheduled',
        notificationId: notification._id
      });
    } catch (error) {
      console.error('Failed to schedule CRUD operation:', error);
      res.status(500).json({
        message: 'Failed to schedule CRUD operation',
        error: error.message
      });
    }
  }
);

// Schedule a view-once share by emails
router.post('/:id/schedule-view-once',
  authenticateToken,
  checkMediaEditPermission,
  [
    body('emails').isArray({ min: 1 }).withMessage('emails must be a non-empty array'),
    body('emails.*').isEmail().withMessage('Each email must be valid'),
    body('scheduledFor').isISO8601().withMessage('scheduledFor must be an ISO8601 date string'),
    body('expiresAt').optional().isISO8601().withMessage('expiresAt must be an ISO8601 date string'),
    body('message').optional().isString().isLength({ max: 500 }).withMessage('message too long')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const media = await Media.findById(req.params.id).populate('folder');
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      const senderId = req.user.id;
      const { emails, scheduledFor, expiresAt, message } = req.body;

      // Map emails to existing users
      const normalizedEmails = emails.map((e) => e.toLowerCase().trim());
      const users = await User.find({ email: { $in: normalizedEmails } });

      if (!users.length) {
        return res.status(404).json({ message: 'No users found for the provided emails' });
      }

      const results = [];
      for (const user of users) {
        try {
          const notif = await Notification.createMediaShareNotification({
            recipientId: user._id,
            senderId,
            mediaId: media._id,
            folderId: media.folder?._id,
            viewOnce: true,
            scheduledFor: new Date(scheduledFor),
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            personalMessage: message || null
          });
          results.push({ email: user.email, success: true, notificationId: notif._id });
        } catch (userErr) {
          console.error(`Failed to schedule view-once for ${user.email}:`, userErr);
          results.push({ email: user.email, success: false, error: userErr.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      res.json({
        message: 'View-once sharing scheduled',
        scheduledCount: successCount,
        results
      });
    } catch (error) {
      console.error('Failed to schedule view-once share:', error);
      res.status(500).json({
        message: 'Failed to schedule view-once share',
        error: error.message
      });
    }
  }
);

// Get download URL (authenticate first, then return Cloudinary URL)
router.get('/:id/download-url', 
  authenticateToken, 
  checkMediaViewAccess,
  async (req, res) => {
    try {
      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      // Mark as viewed if view-once is enabled
      if (media.viewOnce?.enabled) {
        await media.markAsViewed(req.user.id);
      }
      // For Cloudinary assets, use fl_attachment to force download
      let url = media.filePath;
      try {
        if (typeof url === 'string' && url.includes('/upload/')) {
          // Insert fl_attachment/ after /upload/
          url = url.replace('/upload/', '/upload/fl_attachment/');
        } else if (typeof url === 'string' && url.startsWith('http')) {
          // Append download hint as fallback
          const sep = url.includes('?') ? '&' : '?';
          url = `${url}${sep}download=1`;
        }
      } catch (_) {}

      res.json({ url });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to get download URL',
        error: error.message 
      });
    }
  }
);

// Delete media (owner only)
router.delete('/:id', 
  authenticateToken, 
  checkMediaDeletePermission,
  async (req, res) => {
    try {
      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      // Delete from Cloudinary
      if (media.cloudinaryId) {
        try {
          await cloudinary.uploader.destroy(media.cloudinaryId);
        } catch (cloudinaryError) {
          console.error('Failed to delete from Cloudinary:', cloudinaryError);
        }
      }

      // Delete from database
      await Media.findByIdAndDelete(req.params.id);
      
      res.json({ message: 'Media deleted successfully' });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to delete media',
        error: error.message 
      });
    }
  }
);

// Share media with specific users (view-once)
router.post('/:id/share', 
  authenticateToken, 
  checkMediaEditPermission,
  [
    body('userIds').isArray().withMessage('userIds must be an array'),
    body('userIds.*').isMongoId().withMessage('Each userId must be a valid MongoDB ID')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      // Enable view-once and add users
      media.viewOnce.enabled = true;
      for (const userId of req.body.userIds) {
        await media.addViewOnceUser(userId);
      }
      
      await media.populate('viewOnce.sharedWith.user', 'email');

      // Create notifications for each recipient
      try {
        const senderId = req.user.id;
        const folderId = media.folder;
        for (const userId of req.body.userIds) {
          await Notification.createMediaShareNotification({
            recipientId: userId,
            senderId,
            mediaId: media._id,
            folderId,
            viewOnce: true,
          });
        }
      } catch (notifyErr) {
        console.error('Failed to create notifications for media share (userIds):', notifyErr);
      }
      
      res.json({ 
        message: 'Media shared successfully with view-once enabled',
        media: {
          id: media._id,
          viewOnce: {
            enabled: media.viewOnce.enabled,
            sharedWith: media.viewOnce.sharedWith
          }
        }
      });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to share media',
        error: error.message 
      });
    }
  }
);

// Share media directly (new endpoint that doesn't expose folder structure)
router.post('/:id/share-direct', authenticateToken, async (req, res) => {
  try {
    const mediaId = req.params.id;
    const { emails, viewOnce, permission, message, expiresInHours } = req.body;
    const senderId = req.user.id;

    console.log(`Direct sharing media ${mediaId} with emails:`, emails);

    // Validate input
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ message: 'At least one email address is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = emails.filter(email => !emailRegex.test(email));
    if (invalidEmails.length > 0) {
      return res.status(400).json({ 
        message: `Invalid email addresses: ${invalidEmails.join(', ')}` 
      });
    }

    // Get media and verify ownership
    const media = await Media.findById(mediaId).populate('folder');
    if (!media) {
      return res.status(404).json({ message: 'Media not found' });
    }

    if (media.owner.toString() !== senderId) {
      return res.status(403).json({ message: 'You can only share your own media' });
    }

    // Find existing users for the emails; record failures for unknown emails
    const results = [];
    const users = [];
    for (const rawEmail of emails) {
      const email = rawEmail.toLowerCase();
      const user = await User.findOne({ email });
      if (!user) {
        console.warn(`No user found for email: ${email}. Skipping.`);
        results.push({ email, success: false, error: 'User not found' });
        continue;
      }
      users.push(user);
    }

    for (const user of users) {
      try {
        if (viewOnce) {
          // Create view-once notification using the professional notification system
          const NotificationService = require('../services/NotificationService');
          const notification = await NotificationService.createViewOnceNotification({
            recipientId: user._id,
            senderId: senderId,
            mediaId: mediaId,
            folderId: media.folder._id, // Keep folder reference for backend but don't expose to user
            personalMessage: message,
            mediaPreview: {
              thumbnailUrl: media.filePath,
              fileType: media.fileType,
              fileName: media.fileName,
              fileSize: media.size || 0
            },
            expiresInHours: expiresInHours || 24
          });

          results.push({
            email: user.email,
            success: true,
            notificationId: notification._id,
            type: 'view-once'
          });
        } else {
          // Create regular sharing notification
          const notification = new Notification({
            recipient: user._id,
            sender: senderId,
            media: mediaId,
            folder: media.folder._id, // Keep folder reference for backend but don't expose to user
            type: 'media_shared',
            title: '📁 Media Shared',
            message: message || `You have been shared a ${media.fileType} file: ${media.fileName}`,
            viewOnce: false
          });

          await notification.save();

          results.push({
            email: user.email,
            success: true,
            notificationId: notification._id,
            type: 'regular'
          });
        }
      } catch (userError) {
        console.error(`Error sharing with user ${user.email}:`, userError);
        results.push({
          email: user.email,
          success: false,
          error: userError.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    res.json({
      message: `Successfully shared with ${successCount} recipient(s)`,
      results: results,
      successCount,
      failureCount,
      media: {
        id: media._id,
        fileName: media.fileName,
        fileType: media.fileType
      }
    });

  } catch (error) {
    console.error('Direct share error:', error);
    res.status(500).json({ 
      message: 'Failed to share media',
      error: error.message 
    });
  }
});

// Share media with specific users by emails (enables view-once)
router.post('/:id/share-by-email', 
  authenticateToken,
  checkMediaEditPermission,
  [
    body('emails').isArray({ min: 1 }).withMessage('emails must be a non-empty array'),
    body('emails.*').isEmail().withMessage('Each email must be a valid address'),
    body('viewOnce').optional().isBoolean().withMessage('viewOnce must be a boolean'),
    body('permission').optional().isIn(['view', 'upload']).withMessage('permission must be view or upload'),
    body('message').optional().isString().withMessage('message must be a string')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
      }

      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      const emails = req.body.emails.map((e) => e.toLowerCase().trim());
      const users = await User.find({ email: { $in: emails } });

      if (!users.length) {
        return res.status(404).json({ message: 'No users found for the provided emails' });
      }

      // Enable view-once if requested and add each user
      const viewOnce = req.body.viewOnce !== false; // Default to true for backward compatibility
      media.viewOnce.enabled = viewOnce;
      for (const u of users) {
        await media.addViewOnceUser(u._id);
      }

      await media.populate('viewOnce.sharedWith.user', 'email');

      // Create notifications for each recipient
      try {
        const senderId = req.user.id;
        const folderId = media.folder;
        for (const u of users) {
          await Notification.createMediaShareNotification({
            recipientId: u._id,
            senderId,
            mediaId: media._id,
            folderId,
            viewOnce: viewOnce,
            personalMessage: req.body.message
          });
        }
      } catch (notifyErr) {
        // Log but don't fail the share if notifications fail
        console.error('Failed to create notifications for media share:', notifyErr);
      }

      res.json({
        message: 'Media shared by email successfully with view-once enabled',
        sharedCount: users.length,
        media: {
          id: media._id,
          viewOnce: {
            enabled: media.viewOnce.enabled,
            sharedWith: media.viewOnce.sharedWith
          }
        }
      });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to share media by email',
        error: error.message 
      });
    }
  }
);

// Get view-once status for current user
router.get('/:id/view-once-status', 
  authenticateToken, 
  checkMediaViewAccess,
  async (req, res) => {
    try {
      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      const status = media.getViewOnceStatus(req.user.id);
      
      res.json({
        message: 'View-once status retrieved successfully',
        status,
        media: {
          id: media._id,
          viewOnce: {
            enabled: media.viewOnce.enabled,
            sharedWith: media.viewOnce.sharedWith
          }
        }
      });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to get view-once status',
        error: error.message 
      });
    }
  }
);

// Remove user from view-once sharing
router.delete('/:id/share/:userId', 
  authenticateToken, 
  checkMediaEditPermission,
  async (req, res) => {
    try {
      const media = await Media.findById(req.params.id);
      if (!media) {
        return res.status(404).json({ message: 'Media not found' });
      }

      await media.removeViewOnceUser(req.params.userId);
      
      res.json({ 
        message: 'User removed from view-once sharing successfully',
        media: {
          id: media._id,
          viewOnce: {
            enabled: media.viewOnce.enabled,
            sharedWith: media.viewOnce.sharedWith
          }
        }
      });
    } catch (error) {
      res.status(500).json({ 
        message: 'Failed to remove user from sharing',
        error: error.message 
      });
    }
  }
);

// Get all view-once media for current user
router.get('/view-once', authenticateToken, async (req, res) => {
  try {
    const media = await Media.getViewOnceMedia(req.user.id);
    
    res.json({
      message: 'View-once media retrieved successfully',
      media: media.map(item => ({
        id: item._id,
        fileName: item.fileName,
        filePath: item.filePath,
        fileType: item.fileType,
        owner: item.owner ? { id: item.owner._id, email: item.owner.email } : undefined,
        folder: item.folder ? { id: item.folder._id, name: item.folder.name } : undefined,
        viewOnce: {
          enabled: item.viewOnce?.enabled || false,
          sharedWith: item.viewOnce?.sharedWith || []
        },
        createdAt: item.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Failed to retrieve view-once media',
      error: error.message 
    });
  }
});

module.exports = router;
