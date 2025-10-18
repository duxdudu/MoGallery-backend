const Media = require('../models/Media');
const Folder = require('../models/Folder');

// Check if user can view media (not hidden, not already viewed if view-once)
const checkMediaViewAccess = async (req, res, next) => {
  try {
    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ message: 'Media not found' });
    }

    // Check if user can view this media
    if (!media.canView(req.user.id)) {
      return res.status(403).json({ message: 'Access denied to this media' });
    }

    req.media = media;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Check if user can edit media (owner only)
const checkMediaEditPermission = async (req, res, next) => {
  try {
    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ message: 'Media not found' });
    }

    if (!media.canEdit(req.user.id)) {
      return res.status(403).json({ message: 'Only owner can edit this media' });
    }

    req.media = media;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Check if user can delete media (owner only)
const checkMediaDeletePermission = async (req, res, next) => {
  try {
    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ message: 'Media not found' });
    }

    if (!media.canDelete(req.user.id)) {
      return res.status(403).json({ message: 'Only owner can delete this media' });
    }

    req.media = media;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Check if user can upload to folder (owner only)
const checkFolderUploadPermission = async (req, res, next) => {
  try {
    const folder = await Folder.findById(req.params.folderId);
    if (!folder) {
      return res.status(404).json({ message: 'Folder not found' });
    }

    // Only the folder owner can upload
    if (!folder.canEdit(req.user.id)) {
      return res.status(403).json({ message: 'Only folder owner can upload to this folder' });
    }

    req.folder = folder;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  checkMediaViewAccess,
  checkMediaEditPermission,
  checkMediaDeletePermission,
  checkFolderUploadPermission
};

