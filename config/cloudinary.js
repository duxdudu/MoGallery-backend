const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  timeout: 600000 // 10 minutes to accommodate large video uploads
});

// Configure Cloudinary storage for multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isImage = file.mimetype.startsWith('image/');
    const folder = 'mogallery';
    const common = {
      folder,
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi', 'wmv', 'flv', 'webm'],
      resource_type: 'auto'
    };
    
    if (isImage) {
      return {
        ...common,
        transformation: [
          { width: 1920, height: 1080, crop: 'limit' },
          { quality: 'auto' },
          { fetch_format: 'auto' }
        ]
      };
    } else {
      // Video optimizations - reduce dimensions for better performance
      return {
        ...common,
        resource_type: 'video',
        transformation: [
          { width: 1280, height: 720, crop: 'limit' }, // 720p max
          { quality: 'auto' },
          { fetch_format: 'auto' },
          { video_codec: 'auto' }
        ]
      };
    }
  }
});

// Configure multer with Cloudinary storage
const multer = require('multer');

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Check file type
    const allowedImageTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      // iOS formats
      'image/heic', 'image/heif'
    ];
    const allowedVideoTypes = [
      'video/mp4', 'video/mov', 'video/avi', 'video/wmv', 'video/flv', 'video/webm',
      // Common real-world MIME types
      'video/quicktime', // .mov on iOS/macOS
      'video/3gpp', 'video/3gpp2', // 3gp variants
      'video/x-matroska', // .mkv
      'video/ogg'
    ];

    if (allowedImageTypes.includes(file.mimetype) || allowedVideoTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and videos are allowed.'), false);
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

// Create a separate upload configuration for documents
const documentStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    console.log('Cloudinary upload params for file:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });
    
    return {
      folder: 'mogallery/documents',
      resource_type: 'raw', // Use 'raw' for documents
      public_id: `doc_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9]/g, '_')}`,
    };
  }
});

const documentUpload = multer({
  storage: documentStorage,
  fileFilter: (req, file, cb) => {
    // Check file type for documents
    const allowedDocumentTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/rtf',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.apple.pages',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.oasis.opendocument.presentation',
      'application/vnd.oasis.opendocument.spreadsheet'
    ];

    if (allowedDocumentTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only document files are allowed.'), false);
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit for documents
  },
});

module.exports = {
  cloudinary,
  storage,
  upload,
  documentStorage,
  documentUpload,
};
