const Folder = require('../models/Folder');

// Middleware to check if user has access to folder
const checkFolderAccess = async (req, res, next) => {
  try {
    const folderId = req.params.id;
    const userId = req.user.id;

    const folder = await Folder.findById(folderId);
    if (!folder) {
      return res.status(404).json({ message: 'Folder not found' });
    }

    const hasAccess = folder.canViewFolder(userId);

    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied to this folder' });
    }

    req.folder = folder;
    next();
  } catch (error) {
    console.error('Folder access check error:', error);
    res.status(500).json({ message: 'Error checking folder access' });
  }
};

// Middleware to check if user can edit folder (owner only)
const checkFolderEditPermission = async (req, res, next) => {
  try {
    const folder = req.folder;
    const userId = req.user.id;

    if (!folder.canEdit(userId)) {
      return res.status(403).json({ message: 'Only folder owner can edit this folder' });
    }

    next();
  } catch (error) {
    console.error('Folder edit permission check error:', error);
    res.status(500).json({ message: 'Error checking edit permissions' });
  }
};

// Middleware to check if user can delete folder (owner only)
const checkFolderDeletePermission = async (req, res, next) => {
  try {
    const folder = req.folder;
    const userId = req.user.id;

    if (!folder.canDelete(userId)) {
      return res.status(403).json({ message: 'Only folder owner can delete this folder' });
    }

    next();
  } catch (error) {
    console.error('Folder delete permission check error:', error);
    res.status(500).json({ message: 'Error checking delete permissions' });
  }
};

// Middleware to check if user can share folder (owner only)
const checkFolderSharePermission = async (req, res, next) => {
  try {
    const folder = req.folder;
    const userId = req.user.id;

    if (!folder.canShare(userId)) {
      return res.status(403).json({ message: 'Only folder owner can share this folder' });
    }

    next();
  } catch (error) {
    console.error('Folder share permission check error:', error);
    res.status(500).json({ message: 'Error checking share permissions' });
  }
};

// Middleware to check if user can upload to folder (owner or upload permission)
const checkFolderUploadPermission = async (req, res, next) => {
  try {
    const folder = req.folder;
    const userId = req.user.id;

    if (!folder.canUpload(userId)) {
      return res.status(403).json({ message: 'You do not have upload permission for this folder' });
    }

    next();
  } catch (error) {
    console.error('Folder upload permission check error:', error);
    res.status(500).json({ message: 'Error checking upload permissions' });
  }
};

module.exports = {
  checkFolderAccess,
  checkFolderEditPermission,
  checkFolderDeletePermission,
  checkFolderSharePermission,
  checkFolderUploadPermission
};
