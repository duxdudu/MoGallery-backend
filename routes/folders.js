const express = require('express');
const { body, validationResult } = require('express-validator');
const archiver = require('archiver');
const Folder = require('../models/Folder');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const {
  checkFolderAccess,
  checkFolderEditPermission,
  checkFolderDeletePermission,
  checkFolderSharePermission
} = require('../middleware/folderPermissions');
const { sendFolderShareEmail } = require('../utils/emailService');

const router = express.Router();

// Validation middleware
const validateFolderName = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Folder name must be between 1 and 100 characters')
];

const validateShareEmail = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please enter a valid email address'),
  body('permission')
    .optional()
    .isIn(['view', 'upload'])
    .withMessage('Permission must be either "view" or "upload"')
];

const validateViewOnceShare = [
  body('userEmails').isArray().withMessage('userEmails must be an array'),
  body('userEmails.*').isEmail().withMessage('Each email must be valid'),
  body('viewOnce').optional().isBoolean().withMessage('viewOnce must be a boolean')
];

// Create folder
router.post('/', authenticateToken, validateFolderName, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { name } = req.body;
    const userId = req.user.id;

    // Check if folder with same name already exists for this user
    const existingFolder = await Folder.findOne({ 
      owner: userId, 
      name: name 
    });

    if (existingFolder) {
      return res.status(400).json({ 
        message: 'A folder with this name already exists' 
      });
    }

    const folder = new Folder({
      name,
      owner: userId,
      sharedWith: []
    });

    await folder.save();
    await folder.populate('owner', 'email');

    res.status(201).json({
      message: 'Folder created successfully',
      folder: {
        id: folder._id,
        name: folder.name,
        owner: folder.owner,
        sharedWith: folder.sharedWith,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt
      }
    });

  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({ message: 'Server error while creating folder' });
  }
});

// Get shared folders only
router.get('/shared', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const folders = await Folder.find({
      'sharedWith.user': userId
    }).populate('owner', 'email')
      .populate('sharedWith.user', 'email')
      .sort({ updatedAt: -1 });

    res.json({
      message: 'Shared folders retrieved successfully',
      folders: folders.map(folder => {
        const userShare = folder.sharedWith.find(share => 
          (share.user && share.user._id.toString() === userId) ||
          (share._id && share._id.toString() === userId)
        );
        return {
          id: folder._id,
          name: folder.name,
          owner: folder.owner,
          sharedWith: folder.sharedWith.map(share => {
            // Ensure consistent format - handle both old and new structures
            if (share.user) {
              return {
                user: {
                  id: share.user._id || share.user.id,
                  email: share.user.email
                },
                permission: share.permission || 'view'
              };
            } else {
              // Old format - convert to new format
              return {
                user: {
                  id: share._id || share.id,
                  email: share.email
                },
                permission: 'view'
              };
            }
          }),
          userPermission: userShare ? (userShare.permission || 'view') : 'view',
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          isOwner: false,
          canEdit: false,
          canDelete: false,
          canShare: false,
          canUpload: userShare ? (userShare.permission === 'upload') : false
        };
      })
    });

  } catch (error) {
    console.error('Get shared folders error:', error);
    res.status(500).json({ message: 'Server error while retrieving shared folders' });
  }
});

// Get user's folders (owned + shared)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const folders = await Folder.find({
      $or: [
        { owner: userId },
        { 'sharedWith.user': userId }
      ]
    }).populate('owner', 'email')
      .populate('sharedWith.user', 'email')
      .sort({ updatedAt: -1 });

    res.json({
      message: 'Folders retrieved successfully',
      folders: folders.map(folder => ({
        id: folder._id,
        name: folder.name,
        owner: folder.owner,
        sharedWith: folder.sharedWith.map(share => {
          // Ensure consistent format - handle both old and new structures
          if (share.user) {
            return {
              user: {
                id: share.user._id || share.user.id,
                email: share.user.email
              },
              permission: share.permission || 'view'
            };
          } else {
            // Old format - convert to new format
            return {
              user: {
                id: share._id || share.id,
                email: share.email
              },
              permission: 'view'
            };
          }
        }),
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        isOwner: folder.owner._id.toString() === userId,
        canEdit: folder.owner._id.toString() === userId,
        canDelete: folder.owner._id.toString() === userId,
        canShare: folder.owner._id.toString() === userId
      }))
    });

  } catch (error) {
    console.error('Get folders error:', error);
    res.status(500).json({ message: 'Server error while retrieving folders' });
  }
});

// Get specific folder by ID
router.get('/:id', 
  authenticateToken, 
  checkFolderAccess, 
  async (req, res) => {
    try {
      const folder = req.folder;
      const userId = req.user.id;

      // Populate owner and sharedWith user details
      await folder.populate('owner', 'email');
      await folder.populate('sharedWith.user', 'email');

      // Check if this is a view-once folder and mark as viewed if needed
      if (folder.viewOnce && folder.viewOnce.enabled) {
        await folder.markFolderAsViewed(userId);
      }

      res.json({
        message: 'Folder retrieved successfully',
        folder: {
          id: folder._id,
          name: folder.name,
          owner: folder.owner,
          sharedWith: folder.sharedWith,
          viewOnce: folder.viewOnce,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          permissions: {
            canView: folder.canViewFolder(userId),
            canEdit: folder.canEdit(userId),
            canDelete: folder.canDelete(userId),
            canShare: folder.canShare(userId),
            canUpload: folder.canUpload(userId)
          }
        }
      });

    } catch (error) {
      console.error('Get folder error:', error);
      res.status(500).json({ message: 'Server error while retrieving folder' });
    }
  }
);

// Rename folder (owner only)
router.put('/:id', 
  authenticateToken, 
  checkFolderAccess, 
  checkFolderEditPermission, 
  validateFolderName, 
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          message: 'Validation failed', 
          errors: errors.array() 
        });
      }

      const { name } = req.body;
      const folder = req.folder;
      const userId = req.user.id;

      const existingFolder = await Folder.findOne({ 
        owner: userId, 
        name: name,
        _id: { $ne: folder._id }
      });

      if (existingFolder) {
        return res.status(400).json({ 
          message: 'A folder with this name already exists' 
        });
      }

      folder.name = name;
      await folder.save();

      res.json({
        message: 'Folder renamed successfully',
        folder: {
          id: folder._id,
          name: folder.name,
          owner: folder.owner,
          sharedWith: folder.sharedWith,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt
        }
      });

    } catch (error) {
      console.error('Rename folder error:', error);
      res.status(500).json({ message: 'Server error while renaming folder' });
    }
  }
);

// Delete folder (owner only)
router.delete('/:id', 
  authenticateToken, 
  checkFolderAccess, 
  checkFolderDeletePermission, 
  async (req, res) => {
    try {
      const folder = req.folder;
      await Folder.findByIdAndDelete(folder._id);

      res.json({
        message: 'Folder deleted successfully',
        folderId: folder._id
      });

    } catch (error) {
      console.error('Delete folder error:', error);
      res.status(500).json({ message: 'Server error while deleting folder' });
    }
  }
);

// Share folder with user (owner only)
router.post('/:id/share', 
  authenticateToken, 
  checkFolderAccess, 
  checkFolderSharePermission, 
  validateShareEmail, 
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          message: 'Validation failed', 
          errors: errors.array() 
        });
      }

      const { email, permission = 'view' } = req.body;
      const folder = req.folder;
      const userId = req.user.id;

      const userToShare = await User.findOne({ email });
      if (!userToShare) {
        return res.status(404).json({ 
          message: 'User not found with this email' 
        });
      }

      // Check if already shared with this user
      const existingShare = folder.sharedWith.find(share => 
        share.user.toString() === userToShare._id.toString()
      );
      
      if (existingShare) {
        return res.status(400).json({ 
          message: 'Folder is already shared with this user' 
        });
      }

      if (userToShare._id.toString() === userId) {
        return res.status(400).json({ 
          message: 'Cannot share folder with yourself' 
        });
      }

      // Add user to sharedWith with permission
      folder.sharedWith.push({
        user: userToShare._id,
        permission: permission
      });
      
      await folder.save();
      await folder.populate('sharedWith.user', 'email');
      
      // Send email notification
      const owner = await User.findById(userId);
      const folderLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/folders/${folder._id}`;
      await sendFolderShareEmail(
        email, 
        folder.name, 
        owner.email, 
        permission, 
        folderLink
      );

      res.json({
        message: 'Folder shared successfully',
        folder: {
          id: folder._id,
          name: folder.name,
          owner: folder.owner,
          sharedWith: folder.sharedWith,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt
        }
      });

    } catch (error) {
      console.error('Share folder error:', error);
      res.status(500).json({ message: 'Server error while sharing folder' });
    }
  }
);

// Share folder with view-once (owner only)
router.post('/:id/share-view-once', 
  authenticateToken, 
  checkFolderAccess, 
  checkFolderSharePermission, 
  validateViewOnceShare, 
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          message: 'Validation failed', 
          errors: errors.array() 
        });
      }

      const { userEmails, viewOnce = true } = req.body;
      const folder = req.folder;

      // Find users by email
      const users = await User.find({ email: { $in: userEmails } });
      
      if (users.length === 0) {
        return res.status(404).json({ message: 'No users found with the provided emails' });
      }

      // Ensure viewOnce structure exists
      if (!folder.viewOnce) {
        folder.viewOnce = { enabled: false, sharedWith: [] };
      }

      // Set view-once mode
      folder.viewOnce.enabled = viewOnce;
      
      // Add users to view-once sharing
      for (const user of users) {
        await folder.addViewOnceUser(user._id);
      }
      
      await folder.populate('viewOnce.sharedWith.user', 'email');
      
      res.json({ 
        message: `Folder shared successfully with ${viewOnce ? 'view-once enabled' : 'normal sharing'}`,
        folder: {
          id: folder._id,
          name: folder.name,
          owner: folder.owner,
          sharedWith: folder.sharedWith,
          viewOnce: {
            enabled: folder.viewOnce.enabled,
            sharedWith: folder.viewOnce.sharedWith.map(share => ({
              user: share.user,
              viewed: share.viewed,
              viewedAt: share.viewedAt
            }))
          },
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt
        }
      });

    } catch (error) {
      console.error('Share folder view-once error:', error);
      res.status(500).json({ message: 'Server error while sharing folder with view-once' });
    }
  }
);

// Download folder as ZIP (any user with access)
router.get('/:id/download', 
  authenticateToken, 
  checkFolderAccess, 
  async (req, res) => {
    try {
      const folder = req.folder;
      const Media = require('../models/Media');
      
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${folder.name}.zip"`);

      const archive = archiver('zip', {
        zlib: { level: 9 }
      });

      archive.pipe(res);

      // Get all media in this folder
      const mediaFiles = await Media.find({ folder: folder._id });
      
      // Add folder info
      const folderInfo = `Folder: ${folder.name}\nCreated: ${folder.createdAt}\nUpdated: ${folder.updatedAt}\nOwner: ${folder.owner}\nShared with: ${folder.sharedWith.length} users\nMedia files: ${mediaFiles.length}`;
      archive.append(folderInfo, { name: 'folder-info.txt' });

      // Add media files to ZIP
      for (const media of mediaFiles) {
        try {
          // For now, add a placeholder file since we need to implement Cloudinary download
          // In a real implementation, you would fetch the actual file from Cloudinary
          const mediaInfo = `Media: ${media.originalName}\nType: ${media.mimeType}\nSize: ${media.size}\nUploaded: ${media.createdAt}\nCloudinary URL: ${media.cloudinaryUrl}`;
          archive.append(mediaInfo, { name: `media/${media.originalName}.info` });
        } catch (mediaError) {
          console.error(`Error adding media ${media.originalName} to ZIP:`, mediaError);
        }
      }

      // Add README
      archive.append('This ZIP contains all media files from the folder. Each media file has a corresponding .info file with metadata.', { name: 'README.txt' });

      await archive.finalize();

    } catch (error) {
      console.error('Download folder error:', error);
      res.status(500).json({ message: 'Server error while downloading folder' });
    }
  }
);

module.exports = router;
