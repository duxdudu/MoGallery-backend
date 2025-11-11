const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const SocialMediaConnection = require('../models/SocialMediaConnection');
const Folder = require('../models/Folder');
const Media = require('../models/Media');
const { 
  InstagramService, 
  FacebookService, 
  syncInstagramPosts, 
  syncFacebookPosts 
} = require('../services/socialMediaService');

const router = express.Router();

/**
 * Get OAuth URL for Instagram
 */
router.get('/instagram/auth-url', authenticateToken, (req, res) => {
  try {
    const appId = process.env.INSTAGRAM_APP_ID;
    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || `${process.env.FRONTEND_ORIGIN}/dashboard/social/instagram/callback`;
    const scope = 'user_profile,user_media';
    
    if (!appId) {
      return res.status(500).json({ 
        message: 'Instagram App ID not configured' 
      });
    }

    const authUrl = `https://api.instagram.com/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code`;
    
    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating Instagram auth URL:', error);
    res.status(500).json({ message: 'Failed to generate auth URL' });
  }
});

/**
 * Get OAuth URL for Facebook
 */
router.get('/facebook/auth-url', authenticateToken, (req, res) => {
  try {
    const appId = process.env.FACEBOOK_APP_ID;
    const redirectUri = process.env.FACEBOOK_REDIRECT_URI || `${process.env.FRONTEND_ORIGIN}/dashboard/social/facebook/callback`;
    const scope = 'user_posts,user_photos,user_videos';
    
    if (!appId) {
      return res.status(500).json({ 
        message: 'Facebook App ID not configured' 
      });
    }

    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code&state=${req.user.id}`;
    
    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating Facebook auth URL:', error);
    res.status(500).json({ message: 'Failed to generate auth URL' });
  }
});

/**
 * Handle Instagram OAuth callback
 */
router.post('/instagram/callback', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ message: 'Authorization code required' });
    }

    const appId = process.env.INSTAGRAM_APP_ID;
    const appSecret = process.env.INSTAGRAM_APP_SECRET;
    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || `${process.env.FRONTEND_ORIGIN}/dashboard/social/instagram/callback`;

    // Exchange code for access token
    const axios = require('axios');
    const tokenResponse = await axios.post('https://api.instagram.com/oauth/access_token', null, {
      params: {
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code
      }
    });

    const { access_token, user_id } = tokenResponse.data;

    // Get long-lived token
    const longLivedResponse = await axios.get('https://graph.instagram.com/access_token', {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: appSecret,
        access_token
      }
    });

    const longLivedToken = longLivedResponse.data.access_token;
    const expiresIn = longLivedResponse.data.expires_in || 5184000; // 60 days default

    // Get user profile
    const instagramService = new InstagramService(longLivedToken);
    const profile = await instagramService.getUserProfile();

    // Check if connection already exists
    let connection = await SocialMediaConnection.findOne({
      user: req.user.id,
      platform: 'instagram'
    });

    if (connection) {
      // Update existing connection
      connection.accessToken = longLivedToken;
      connection.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
      connection.platformUserId = user_id || profile.id;
      connection.platformUsername = profile.username;
      connection.isActive = true;
      await connection.save();
    } else {
      // Create new connection
      connection = new SocialMediaConnection({
        user: req.user.id,
        platform: 'instagram',
        accessToken: longLivedToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId: user_id || profile.id,
        platformUsername: profile.username
      });
      await connection.save();
    }

    res.json({
      success: true,
      message: 'Instagram account connected successfully',
      connection: {
        id: connection._id,
        platform: connection.platform,
        username: connection.platformUsername,
        isActive: connection.isActive
      }
    });
  } catch (error) {
    console.error('Error handling Instagram callback:', error.response?.data || error.message);
    res.status(500).json({ 
      message: 'Failed to connect Instagram account',
      error: error.response?.data || error.message 
    });
  }
});

/**
 * Handle Facebook OAuth callback
 */
router.post('/facebook/callback', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ message: 'Authorization code required' });
    }

    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    const redirectUri = process.env.FACEBOOK_REDIRECT_URI || `${process.env.FRONTEND_ORIGIN}/dashboard/social/facebook/callback`;

    // Exchange code for access token
    const axios = require('axios');
    const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code
      }
    });

    const { access_token, expires_in } = tokenResponse.data;

    // Get long-lived token
    const longLivedResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: access_token
      }
    });

    const longLivedToken = longLivedResponse.data.access_token;
    const expiresIn = longLivedResponse.data.expires_in || 5184000; // 60 days default

    // Get user profile
    const facebookService = new FacebookService(longLivedToken);
    const profile = await facebookService.getUserProfile();

    // Check if connection already exists
    let connection = await SocialMediaConnection.findOne({
      user: req.user.id,
      platform: 'facebook'
    });

    if (connection) {
      // Update existing connection
      connection.accessToken = longLivedToken;
      connection.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
      connection.platformUserId = profile.id;
      connection.platformUsername = profile.name;
      connection.platformProfilePicture = profile.picture?.data?.url;
      connection.isActive = true;
      await connection.save();
    } else {
      // Create new connection
      connection = new SocialMediaConnection({
        user: req.user.id,
        platform: 'facebook',
        accessToken: longLivedToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId: profile.id,
        platformUsername: profile.name,
        platformProfilePicture: profile.picture?.data?.url
      });
      await connection.save();
    }

    res.json({
      success: true,
      message: 'Facebook account connected successfully',
      connection: {
        id: connection._id,
        platform: connection.platform,
        username: connection.platformUsername,
        isActive: connection.isActive
      }
    });
  } catch (error) {
    console.error('Error handling Facebook callback:', error.response?.data || error.message);
    res.status(500).json({ 
      message: 'Failed to connect Facebook account',
      error: error.response?.data || error.message 
    });
  }
});

/**
 * Get user's social media connections
 */
router.get('/connections', authenticateToken, async (req, res) => {
  try {
    const connections = await SocialMediaConnection.find({
      user: req.user.id
    }).populate('memoriesFolder', 'name');

    res.json({
      success: true,
      connections: connections.map(conn => ({
        id: conn._id,
        platform: conn.platform,
        username: conn.platformUsername,
        profilePicture: conn.platformProfilePicture,
        autoSync: conn.autoSync,
        isActive: conn.isActive,
        lastSyncAt: conn.lastSyncAt,
        memoriesFolder: conn.memoriesFolder ? {
          id: conn.memoriesFolder._id,
          name: conn.memoriesFolder.name
        } : null
      }))
    });
  } catch (error) {
    console.error('Error fetching connections:', error);
    res.status(500).json({ message: 'Failed to fetch connections' });
  }
});

/**
 * Disconnect a social media account
 */
router.delete('/connections/:id', authenticateToken, async (req, res) => {
  try {
    const connection = await SocialMediaConnection.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!connection) {
      return res.status(404).json({ message: 'Connection not found' });
    }

    connection.isActive = false;
    await connection.save();

    res.json({
      success: true,
      message: 'Account disconnected successfully'
    });
  } catch (error) {
    console.error('Error disconnecting account:', error);
    res.status(500).json({ message: 'Failed to disconnect account' });
  }
});

/**
 * Toggle auto-sync for a connection
 */
router.patch('/connections/:id/auto-sync', authenticateToken, async (req, res) => {
  try {
    const { autoSync } = req.body;
    const connection = await SocialMediaConnection.findOne({
      _id: req.params.id,
      user: req.user.id
    });

    if (!connection) {
      return res.status(404).json({ message: 'Connection not found' });
    }

    connection.autoSync = autoSync !== undefined ? autoSync : !connection.autoSync;
    await connection.save();

    res.json({
      success: true,
      message: `Auto-sync ${connection.autoSync ? 'enabled' : 'disabled'}`,
      autoSync: connection.autoSync
    });
  } catch (error) {
    console.error('Error toggling auto-sync:', error);
    res.status(500).json({ message: 'Failed to toggle auto-sync' });
  }
});

/**
 * Manually sync posts from a connected account
 */
router.post('/connections/:id/sync', authenticateToken, async (req, res) => {
  try {
    const connection = await SocialMediaConnection.findOne({
      _id: req.params.id,
      user: req.user.id,
      isActive: true
    });

    if (!connection) {
      return res.status(404).json({ message: 'Connection not found or inactive' });
    }

    let result;
    if (connection.platform === 'instagram') {
      result = await syncInstagramPosts(connection);
    } else if (connection.platform === 'facebook') {
      result = await syncFacebookPosts(connection);
    } else {
      return res.status(400).json({ message: 'Unsupported platform' });
    }

    res.json({
      success: true,
      message: `Synced ${result.newPostsCount} new posts`,
      ...result
    });
  } catch (error) {
    console.error('Error syncing posts:', error);
    res.status(500).json({ 
      message: 'Failed to sync posts',
      error: error.message 
    });
  }
});

/**
 * Get synced memories from a connection
 */
router.get('/connections/:id/memories', authenticateToken, async (req, res) => {
  try {
    const connection = await SocialMediaConnection.findOne({
      _id: req.params.id,
      user: req.user.id
    }).populate('memoriesFolder');

    if (!connection || !connection.memoriesFolder) {
      return res.json({
        success: true,
        memories: []
      });
    }

    const memories = await Media.find({
      folder: connection.memoriesFolder._id,
      'metadata.platform': connection.platform
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      memories: memories.map(m => ({
        id: m._id,
        fileName: m.fileName,
        filePath: m.filePath,
        fileType: m.fileType,
        metadata: m.metadata,
        createdAt: m.createdAt
      }))
    });
  } catch (error) {
    console.error('Error fetching memories:', error);
    res.status(500).json({ message: 'Failed to fetch memories' });
  }
});

module.exports = router;

