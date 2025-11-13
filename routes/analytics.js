const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Media = require('../models/Media');
const Folder = require('../models/Folder');
const Notification = require('../models/Notification');
const DeviceUsage = require('../models/DeviceUsage');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Get user dashboard statistics
router.get('/dashboard-stats', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get basic counts
    const [folders, media, notifications] = await Promise.all([
      Folder.countDocuments({ owner: userId }),
      Media.countDocuments({ owner: userId }),
      Notification.countDocuments({ userId, isRead: false })
    ]);

    // Get media type breakdown
    const mediaTypes = await Media.aggregate([
      { $match: { owner: userId } },
      { $group: { _id: '$fileType', count: { $sum: 1 } } }
    ]);

    const images = mediaTypes.find(m => m._id === 'image')?.count || 0;
    const videos = mediaTypes.find(m => m._id === 'video')?.count || 0;

    // Get shared items count
    const sharedFolders = await Folder.countDocuments({
      'sharedWith.user': userId,
      owner: { $ne: userId }
    });

    const sharedMedia = await Media.countDocuments({
      'viewOnce.sharedWith.user': userId,
      owner: { $ne: userId }
    });

    // Calculate storage usage using actual file sizes stored on Media.size (bytes)
    // and any file-backed Documents. Sum sizes in bytes and convert to MB for display.
    // If no size field exists (older records), they will be treated as 0.
    // Aggregate media sizes
    const mediaSizeAgg = await Media.aggregate([
      { $match: { owner: userId } },
      { $group: { _id: null, totalBytes: { $sum: { $ifNull: ['$size', 0] } } } }
    ]);
    const mediaBytes = (mediaSizeAgg[0] && mediaSizeAgg[0].totalBytes) ? mediaSizeAgg[0].totalBytes : 0;

    // Include documents that have fileUrl/fileType pointing to uploaded files.
    // We assume documents that represent uploaded files should include a `size` field
    // (if not present older docs are treated as 0). To be robust, try to aggregate by a `size` field on Document.
    let documentBytes = 0;
    try {
      const Document = require('../models/Document');
      const docSizeAgg = await Document.aggregate([
        { $match: { owner: mongoose.Types.ObjectId(userId), size: { $exists: true } } },
        { $group: { _id: null, totalBytes: { $sum: { $ifNull: ['$size', 0] } } } }
      ]);
      documentBytes = (docSizeAgg[0] && docSizeAgg[0].totalBytes) ? docSizeAgg[0].totalBytes : 0;
    } catch (err) {
      // If Document model or size field doesn't exist, treat as 0 and continue
      documentBytes = 0;
    }

    const totalBytes = mediaBytes + documentBytes;
    const storageUsedMB = +(totalBytes / (1024 * 1024)).toFixed(2);

    // Storage limit: prefer per-user setting, then default env var, otherwise null (unlimited)
    const userDoc = await User.findById(userId).select('storageLimitMB createdAt');
    const storageLimitMB = (userDoc && userDoc.storageLimitMB != null)
      ? Number(userDoc.storageLimitMB)
      : (process.env.DEFAULT_STORAGE_LIMIT_MB ? Number(process.env.DEFAULT_STORAGE_LIMIT_MB) : 2048);

    // Compute remaining MB and percent used (if limit exists)
    const storageRemainingMB = storageLimitMB != null ? Math.max(0, +(storageLimitMB - storageUsedMB).toFixed(2)) : null;
    const storagePercentUsed = storageLimitMB != null ? +((storageUsedMB / storageLimitMB) * 100).toFixed(2) : null;

    // Get account age
  const accountAge = Math.floor((Date.now() - userDoc.createdAt.getTime()) / (1000 * 60 * 60 * 24));

    res.json({
      success: true,
      data: {
        folders,
        images,
        videos,
        totalMedia: media,
        notifications,
        sharedItems: sharedFolders + sharedMedia,
  storageUsedMB,
  storageLimitMB,
  storageRemainingMB,
  storagePercentUsed,
        accountAge,
        lastActivity: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard statistics' });
  }
});

// Get media uploads trend (last 6 months)
router.get('/media-uploads-trend', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const uploads = await Media.aggregate([
      { $match: { owner: userId, createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Format data for chart
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentDate = new Date();
    const chartData = [];

    // Generate data for the last 6 months including current month
    for (let i = 5; i >= 0; i--) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
      const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
      const uploadData = uploads.find(u => `${u._id.year}-${u._id.month}` === monthKey);
      
      chartData.push({
        month: months[date.getMonth()],
        count: uploadData ? uploadData.count : 0
      });
    }

    // If no data exists, create some sample data to show the chart structure
    if (chartData.every(item => item.count === 0)) {
      // Add current month with at least 1 upload if user has any media
      const totalMedia = await Media.countDocuments({ owner: userId });
      if (totalMedia > 0) {
        chartData[chartData.length - 1].count = Math.min(totalMedia, 5); // Show up to 5 for current month
      }
    }

    res.json({
      success: true,
      data: chartData
    });
  } catch (error) {
    console.error('Error fetching media uploads trend:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch uploads trend' });
  }
});

// Get storage usage breakdown
router.get('/storage-usage', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const storageBreakdown = await Media.aggregate([
      { $match: { owner: userId } },
      {
        $group: {
          _id: '$fileType',
          count: { $sum: 1 },
          totalSize: { $sum: { $cond: [{ $eq: ['$fileType', 'image'] }, 2.5, 15.2] } }
        }
      }
    ]);

    const chartData = storageBreakdown.map(item => ({
      type: item._id === 'image' ? 'Images' : 'Videos',
      value: item.totalSize,
      color: item._id === 'image' ? '#3B82F6' : '#EF4444'
    }));

    // Add other file types (mock data)
    chartData.push(
      { type: 'Documents', value: 125, color: '#10B981' },
      { type: 'Other', value: 89, color: '#F59E0B' }
    );

    res.json({
      success: true,
      data: chartData
    });
  } catch (error) {
    console.error('Error fetching storage usage:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch storage usage' });
  }
});

// Get weekly activity data for current week (Monday to Sunday)
router.get('/weekly-activity', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Calculate current week (Monday to Sunday)
    const today = new Date();
    const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    // Calculate Monday of current week
    const monday = new Date(today);
    monday.setDate(today.getDate() - (currentDay === 0 ? 6 : currentDay - 1));
    monday.setHours(0, 0, 0, 0);
    
    // Calculate Sunday of current week
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    // Also create a broader range to catch any timezone issues
    const weekStart = new Date(monday);
    weekStart.setDate(monday.getDate() - 1); // Start from day before Monday
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(sunday);
    weekEnd.setDate(sunday.getDate() + 1); // End day after Sunday
    weekEnd.setHours(23, 59, 59, 999);

    console.log(`Current week: ${monday.toDateString()} to ${sunday.toDateString()}`);

    // Debug: Check total media count for user
    const totalMedia = await Media.countDocuments({ owner: userId });
    console.log(`Total media for user ${userId}: ${totalMedia}`);

    // Get uploads for current week by actual date (with broader range)
    const uploads = await Media.aggregate([
      { 
        $match: { 
          owner: userId, 
          createdAt: { $gte: weekStart, $lte: weekEnd } 
        } 
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get views (mock data for now - you can implement view tracking)
    const views = await Media.aggregate([
      { 
        $match: { 
          owner: userId, 
          createdAt: { $gte: weekStart, $lte: weekEnd } 
        } 
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: { $multiply: [{ $rand: {} }, 10] } } // Mock view count
        }
      }
    ]);

    // Get shares (mock data for now)
    const shares = await Media.aggregate([
      { 
        $match: { 
          owner: userId, 
          createdAt: { $gte: weekStart, $lte: weekEnd } 
        } 
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: { $multiply: [{ $rand: {} }, 5] } } // Mock share count
        }
      }
    ]);

    console.log('Uploads aggregation result:', uploads);

    // If no uploads found in current week, get recent uploads as fallback
    let fallbackUploads = [];
    if (uploads.length === 0 && totalMedia > 0) {
      console.log('No uploads in current week, getting recent uploads...');
      const recentMedia = await Media.find({ owner: userId })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('createdAt');
      
      // Group recent uploads by day
      const recentUploads = recentMedia.reduce((acc, media) => {
        const date = new Date(media.createdAt);
        const dateKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
        acc[dateKey] = (acc[dateKey] || 0) + 1;
        return acc;
      }, {});
      
      // Convert to aggregation format
      fallbackUploads = Object.entries(recentUploads).map(([dateKey, count]) => {
        const [year, month, day] = dateKey.split('-').map(Number);
        return {
          _id: { year, month, day },
          count: count
        };
      });
      
      console.log('Fallback uploads:', fallbackUploads);
    }

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const chartData = [];

    // Generate data for current week (Monday to Sunday)
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      
      const dateKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
      
      console.log(`Looking for date: ${dateKey}`);
      
      // Check both regular uploads and fallback uploads
      const uploadData = uploads.find(u => {
        const uploadKey = `${u._id.year}-${u._id.month}-${u._id.day}`;
        console.log(`Checking upload key: ${uploadKey} against ${dateKey}`);
        return uploadKey === dateKey;
      }) || fallbackUploads.find(u => {
        const uploadKey = `${u._id.year}-${u._id.month}-${u._id.day}`;
        return uploadKey === dateKey;
      });
      const viewData = views.find(v => 
        `${v._id.year}-${v._id.month}-${v._id.day}` === dateKey
      );
      const shareData = shares.find(s => 
        `${s._id.year}-${s._id.month}-${s._id.day}` === dateKey
      );

      chartData.push({
        day: days[i],
        date: date.toDateString(),
        uploads: uploadData ? uploadData.count : 0,
        views: viewData ? Math.floor(viewData.count) : 0,
        shares: shareData ? Math.floor(shareData.count) : 0
      });
    }

    console.log('Final chart data:', chartData);

    res.json({
      success: true,
      data: chartData
    });
  } catch (error) {
    console.error('Error fetching weekly activity:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch weekly activity' });
  }
});

// Track device usage
router.post('/track-device', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceType } = req.body;

    if (!deviceType || !['Mobile', 'Desktop', 'Tablet'].includes(deviceType)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid device type. Must be Mobile, Desktop, or Tablet' 
      });
    }

    // Create device usage record
    const deviceUsage = new DeviceUsage({
      userId,
      deviceType,
      userAgent: req.headers['user-agent'] || ''
    });

    await deviceUsage.save();

    res.json({
      success: true,
      message: 'Device usage tracked successfully'
    });
  } catch (error) {
    console.error('Error tracking device usage:', error);
    res.status(500).json({ success: false, message: 'Failed to track device usage' });
  }
});

// Get device usage statistics (aggregated from all users)
router.get('/device-usage', auth.authenticateToken, async (req, res) => {
  try {
    // Aggregate device usage data from all users
    const deviceStats = await DeviceUsage.aggregate([
      {
        $group: {
          _id: '$deviceType',
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          device: '$_id',
          count: 1,
          _id: 0
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Ensure all device types are represented (even if count is 0)
    const deviceTypes = ['Mobile', 'Desktop', 'Tablet'];
    const deviceMap = new Map(deviceStats.map(d => [d.device, d.count]));
    
    const deviceData = deviceTypes.map(device => ({
      device,
      count: deviceMap.get(device) || 0
    }));

    res.json({
      success: true,
      data: deviceData
    });
  } catch (error) {
    console.error('Error fetching device usage:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch device usage' });
  }
});

// Get recent activity
router.get('/recent-activity', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;

    const recentMedia = await Media.find({ owner: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('folder', 'name')
      .select('fileName fileType createdAt folder');

    const recentFolders = await Folder.find({ owner: userId })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .select('name updatedAt');

    const activities = [
      ...recentMedia.map(media => ({
        type: 'media_upload',
        title: `Uploaded ${media.fileType}`,
        description: media.fileName,
        timestamp: media.createdAt,
        icon: media.fileType === 'image' ? 'image' : 'video'
      })),
      ...recentFolders.map(folder => ({
        type: 'folder_update',
        title: 'Updated folder',
        description: folder.name,
        timestamp: folder.updatedAt,
        icon: 'folder'
      }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);

    res.json({
      success: true,
      data: activities
    });
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch recent activity' });
  }
});

// Get system features status
router.get('/system-features', auth.authenticateToken, async (req, res) => {
  try {
    const features = [
      {
        id: 'cloud-storage',
        name: 'Cloud Storage',
        description: 'Secure cloud storage with automatic backup and sync',
        status: 'active',
        icon: 'cloud'
      },
      {
        id: 'advanced-sharing',
        name: 'Advanced Sharing',
        description: 'Share media with view-once, time-limited, and permission controls',
        status: 'active',
        icon: 'share'
      },
      {
        id: 'security-privacy',
        name: 'Security & Privacy',
        description: 'End-to-end encryption and privacy controls',
        status: 'active',
        icon: 'shield'
      },
      {
        id: 'multi-platform',
        name: 'Multi-Platform',
        description: 'Access from any device with responsive design',
        status: 'active',
        icon: 'smartphone'
      },
      {
        id: 'notifications',
        name: 'Smart Notifications',
        description: 'Real-time notifications and activity tracking',
        status: 'active',
        icon: 'bell'
      },
      {
        id: 'analytics',
        name: 'Analytics Dashboard',
        description: 'Comprehensive analytics and usage insights',
        status: 'active',
        icon: 'bar-chart'
      }
    ];

    res.json({
      success: true,
      data: features
    });
  } catch (error) {
    console.error('Error fetching system features:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch system features' });
  }
});

// Debug endpoint to check media data
router.get('/debug-media', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get all media for the user
    const allMedia = await Media.find({ owner: userId })
      .select('fileName createdAt fileType')
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Get media from current week
    const today = new Date();
    const currentDay = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (currentDay === 0 ? 6 : currentDay - 1));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    const currentWeekMedia = await Media.find({ 
      owner: userId,
      createdAt: { $gte: monday, $lte: sunday }
    }).select('fileName createdAt fileType');
    
    res.json({
      success: true,
      data: {
        totalMedia: allMedia.length,
        currentWeekMedia: currentWeekMedia.length,
        allMedia: allMedia,
        currentWeekMedia: currentWeekMedia,
        weekRange: {
          monday: monday.toISOString(),
          sunday: sunday.toISOString()
        }
      }
    });
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    res.status(500).json({ success: false, message: 'Debug failed' });
  }
});

module.exports = router;

// Server-Sent Events (SSE) stream for realtime analytics
// Endpoint: GET /api/analytics/stream
// Notes: Uses MongoDB Change Streams (Atlas supports this). Auth required.
router.get('/stream', async (req, res) => {
  // Authenticate first (EventSource won't set Authorization headers reliably for some clients)
  const cookieToken = req.cookies && req.cookies.mogallery_token;
  const token = cookieToken || req.query?.token || (req.headers['authorization'] ? req.headers['authorization'].split(' ')[1] : null);
  if (!token) return res.status(401).json({ success: false, message: 'Access token required for analytics stream' });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    console.error('Invalid token for analytics stream', err);
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  const user = await User.findById(decoded.userId).select('-password -otp -otpExpires');
  if (!user) return res.status(401).json({ success: false, message: 'Invalid token user' });
  if (!user.isVerified) return res.status(403).json({ success: false, message: 'Email not verified' });

  // Set SSE headers after successful auth
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  if (res.flushHeaders) res.flushHeaders();

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  try {
    // Helper to compute a compact dashboard snapshot for the requesting user
    const computeSnapshot = async (userId) => {
      const db = mongoose.connection.db;
      const folders = await db.collection('folders').countDocuments({ owner: userId });
      const media = await db.collection('media').countDocuments({ owner: userId });
      const notifications = await db.collection('notifications').countDocuments({ userId: userId, isRead: false });
      const mediaTypes = await db.collection('media').aggregate([
        { $match: { owner: userId } },
        { $group: { _id: '$fileType', count: { $sum: 1 } } }
      ]).toArray();
      const images = mediaTypes.find(m => m._id === 'image')?.count || 0;
      const videos = mediaTypes.find(m => m._id === 'video')?.count || 0;
      return {
        folders,
        images,
        videos,
        totalMedia: media,
        notifications,
        lastActivity: new Date().toISOString()
      };
    };

  const userId = user.id;

    // Send initial snapshot
    const initial = await computeSnapshot(userId);
    res.write(`event: analytics\ndata: ${JSON.stringify({ type: 'initial', payload: initial })}\n\n`);

    // Open change streams for collections relevant to analytics
    const collNames = ['media', 'folders', 'notifications'];
    const changeStreams = collNames.map(name => mongoose.connection.collection(name).watch([], { fullDocument: 'updateLookup' }));

    // Buffer/throttle changes and send aggregated snapshot every 1s when changes occur
    let scheduled = false;
    const scheduleSend = () => {
      if (scheduled || closed) return;
      scheduled = true;
      setTimeout(async () => {
        try {
          if (closed) return;
          const snap = await computeSnapshot(userId);
          res.write(`event: analytics\ndata: ${JSON.stringify({ type: 'update', payload: snap })}\n\n`);
        } catch (err) {
          console.error('Error computing analytics snapshot:', err);
        } finally {
          scheduled = false;
        }
      }, 1000);
    };

    changeStreams.forEach(cs => cs.on('change', () => scheduleSend()));

    // On client disconnect cleanup
    req.on('close', () => {
      changeStreams.forEach(cs => { try { cs.close(); } catch (e) {} });
    });
  } catch (err) {
    console.error('Error in analytics SSE stream:', err);
    // If headers are not sent, send an HTTP error
    if (!res.headersSent) return res.status(500).json({ success: false, message: 'Failed to start analytics stream' });
    try { res.end(); } catch (e) {}
  }
});
