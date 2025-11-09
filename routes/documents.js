const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { documentUpload } = require('../config/cloudinary');
const path = require('path');
const Document = require('../models/Document');
const https = require('https');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

const router = express.Router();

const downloadFile = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to get file from ${url}, status code: ${response.statusCode}`));
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', (err) => reject(err));
  });
};

// List documents for current user with search/sort/filter
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { q, tag, sort = 'updatedAt:desc' } = req.query;
    const [sortField, sortDir] = String(sort).split(':');
    const query = { owner: req.user.id };
    if (q) {
      const regex = new RegExp(String(q).trim(), 'i');
      Object.assign(query, { $or: [{ title: regex }, { content: regex }] });
    }
    if (tag) {
      Object.assign(query, { tags: String(tag) });
    }
    const sortObj = { [sortField]: sortDir === 'asc' ? 1 : -1 };
    const docs = await Document.find(query).sort(sortObj);
    res.json({ documents: docs });
  } catch (e) {
    console.error('List documents error:', e);
    res.status(500).json({ message: 'Server error while listing documents' });
  }
});

// Create text document
router.post(
  '/',
  authenticateToken,
  [body('title').isLength({ min: 1, max: 200 }), body('content').optional().isString()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
      }
      const { title, content = '' } = req.body;
      const doc = new Document({ owner: req.user.id, title, content });
      await doc.save();
      res.status(201).json({ message: 'Document created', document: doc });
    } catch (e) {
      console.error('Create document error:', e);
      res.status(500).json({ message: 'Server error while creating document' });
    }
  }
);

// Update text document (title/content/tags)
router.put(
  '/:id',
  authenticateToken,
  [
    body('title').optional().isLength({ min: 1, max: 200 }),
    body('content').optional().isString(),
    body('tags').optional().isArray(),
    body('tags.*').optional().isString(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
      }
      const doc = await Document.findById(req.params.id);
      if (!doc) return res.status(404).json({ message: 'Document not found' });
      if (String(doc.owner) !== String(req.user.id)) return res.status(403).json({ message: 'Forbidden' });

      const { title, content, tags } = req.body;
      if (title !== undefined) doc.title = title;
      if (content !== undefined) doc.content = content;
      if (Array.isArray(tags)) doc.tags = tags;
      await doc.save();
      res.json({ message: 'Document updated', document: doc });
    } catch (e) {
      console.error('Update document error:', e);
      res.status(500).json({ message: 'Server error while updating document' });
    }
  }
);

// Get document by id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    if (String(doc.owner) !== String(req.user.id)) return res.status(403).json({ message: 'Forbidden' });
    res.json({ document: doc });
  } catch (e) {
    console.error('Get document error:', e);
    res.status(500).json({ message: 'Server error while fetching document' });
  }
});

// Upload a file as a document (stores file URL)
router.post('/upload', authenticateToken, (req, res, next) => {
  // Wrap multer middleware to catch errors
  documentUpload.single('file')(req, res, (err) => {
    if (err) {
      console.error('Multer upload error:', err);
      return res.status(400).json({ 
        message: err.message || 'File upload failed',
        code: err.code || 'UPLOAD_ERROR'
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    console.log('Upload request received:', {
      hasFile: !!req.file,
      fileName: req.file?.originalname,
      fileSize: req.file?.size,
      fileType: req.file?.mimetype,
      userId: req.user?.id
    });

      if (!req.file) return res.status(400).json({ message: 'No file provided' });

      const title = req.body?.title || req.file.originalname;
      const fileUrl = req.file.path;
      const fileType = req.file.mimetype;
      const fileSize = req.file.size || 0; // bytes

      console.log('Creating document:', { title, fileUrl, fileType, fileSize });

      // Enforce per-user storage limit before saving
      try {
        const { wouldExceedLimit } = require('../utils/storage');
        const User = require('../models/User');
        const user = await User.findById(req.user.id).select('storageLimitMB');
        const userLimitMB = user && user.storageLimitMB != null ? user.storageLimitMB : (process.env.DEFAULT_STORAGE_LIMIT_MB ? Number(process.env.DEFAULT_STORAGE_LIMIT_MB) : null);
        const check = await wouldExceedLimit(req.user.id, fileSize, userLimitMB);
        if (!check.allowed) {
          const remainingMB = +(check.remainingBytes / (1024 * 1024)).toFixed(2);
          return res.status(413).json({ message: `Upload exceeds your storage limit. ${remainingMB} MB remaining.` });
        }
      } catch (limitErr) {
        console.error('Storage limit check failed, allowing upload by default:', limitErr);
      }

      let content = '';
      try {
        const fileBuffer = await downloadFile(fileUrl);
        if (fileType === 'application/pdf') {
          const data = await pdf(fileBuffer);
          content = data.text;
        } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          // .docx files - extract text using mammoth
          const { value } = await mammoth.extractRawText({ buffer: fileBuffer });
          content = value;
        } else if (fileType === 'application/msword') {
          // .doc files now(old format) - mammoth doesn't support these
          // For now, we'll save the file but leave content empty
          // Users can still download and view the file
          content = '[Content extraction not available for .doc files. Please use .docx format for text extraction.]';
          console.warn('Text extraction not supported for .doc files. File uploaded but content not extracted.');
        } else if (fileType === 'text/plain') {
          content = fileBuffer.toString('utf8');
        }
      } catch (extractError) {
        console.error('Text extraction failed:', extractError);
        // Don't fail the upload if extraction fails - just save with empty content
        // The file is still available for download
        content = '[Content extraction failed. The file has been uploaded and is available for download.]';
        console.warn('Continuing with upload despite extraction failure');
      }

      const doc = new Document({ owner: req.user.id, title, fileUrl, fileType, size: fileSize, content });
      await doc.save();
    
      console.log('Document saved successfully:', doc._id);
      res.status(201).json({ message: 'File uploaded', document: doc });
  } catch (e) {
    console.error('Upload document error:', e);
    res.status(500).json({ message: 'Server error while uploading document' });
  }
});

// Download: redirect to stored file URL (if present)
router.get('/:id/download', authenticateToken, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    if (String(doc.owner) !== String(req.user.id)) return res.status(403).json({ message: 'Forbidden' });
    if (!doc.fileUrl) return res.status(400).json({ message: 'Document is not a file' });
    return res.redirect(doc.fileUrl);
  } catch (e) {
    console.error('Download document error:', e);
    res.status(500).json({ message: 'Server error while downloading document' });
  }
});

// Delete a document
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    if (String(doc.owner) !== String(req.user.id)) return res.status(403).json({ message: 'Forbidden' });
    await doc.deleteOne();
    res.json({ message: 'Document deleted' });
  } catch (e) {
    console.error('Delete document error:', e);
    res.status(500).json({ message: 'Server error while deleting document' });
  }
});

// Duplicate a document
router.post('/:id/duplicate', authenticateToken, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    if (String(doc.owner) !== String(req.user.id)) return res.status(403).json({ message: 'Forbidden' });
    const clone = new Document({
      owner: req.user.id,
      title: `${doc.title} (Copy)`,
      content: doc.content,
      tags: doc.tags,
      fileUrl: doc.fileUrl,
      fileType: doc.fileType,
      thumbnail: doc.thumbnail,
    });
    await clone.save();
    res.status(201).json({ message: 'Document duplicated', document: clone });
  } catch (e) {
    console.error('Duplicate document error:', e);
    res.status(500).json({ message: 'Server error while duplicating document' });
  }
});

module.exports = router;


