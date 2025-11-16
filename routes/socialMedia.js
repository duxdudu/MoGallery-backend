const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const SocialMediaConnection = require('../models/SocialMediaConnection');
const Folder = require('../models/Folder');
const Media = require('../models/Media');
const { 
  InstagramService, 
  FacebookService,
  TikTokService,
  TwitterService,
  FacebookPageService,
  syncInstagramPosts, 
  syncFacebookPosts,
  syncTikTokPosts,
  syncTwitterPosts,
  syncFacebookPagePosts
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
    } else if (connection.platform === 'facebook_page') {
      result = await syncFacebookPagePosts(connection);
    } else if (connection.platform === 'tiktok') {
      result = await syncTikTokPosts(connection);
    } else if (connection.platform === 'twitter') {
      result = await syncTwitterPosts(connection);
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

/**
 * Get all synced posts across all platforms
 */
router.get('/synced-posts', authenticateToken, async (req, res) => {
  try {
    const { platform, limit = 50, skip = 0 } = req.query;
    
    // Get all connections for this user
    const connections = await SocialMediaConnection.find({
      user: req.user.id,
      isActive: true
    }).select('memoriesFolder platform');
    
    const folderIds = connections
      .filter(c => c.memoriesFolder)
      .map(c => c.memoriesFolder);
    
    if (folderIds.length === 0) {
      return res.json({
        success: true,
        posts: [],
        total: 0
      });
    }
    
    // Build query
    const query = {
      folder: { $in: folderIds },
      syncedAutomatically: true
    };
    
    if (platform) {
      query.platform = platform;
    }
    
    const posts = await Media.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .populate('folder', 'name')
      .populate('owner', 'email');
    
    const total = await Media.countDocuments(query);
    
    res.json({
      success: true,
      posts: posts.map(m => ({
        id: m._id,
        fileName: m.fileName,
        filePath: m.filePath,
        fileType: m.fileType,
        platform: m.platform,
        platformPostId: m.platformPostId,
        metadata: m.metadata,
        folder: m.folder ? { id: m.folder._id, name: m.folder.name } : null,
        createdAt: m.createdAt
      })),
      total
    });
  } catch (error) {
    console.error('Error fetching synced posts:', error);
    res.status(500).json({ message: 'Failed to fetch synced posts' });
  }
});

/**
 * Get OAuth URL for TikTok
 */
router.get('/tiktok/auth-url', authenticateToken, (req, res) => {
  try {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI || `${process.env.FRONTEND_ORIGIN}/dashboard/social/tiktok/callback`;
    const scope = 'user.info.basic,video.list';
    const state = Buffer.from(JSON.stringify({ userId: req.user.id })).toString('base64');
    
    if (!clientKey) {
      return res.status(500).json({ 
        message: 'TikTok Client Key not configured' 
      });
    }

    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${scope}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    
    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating TikTok auth URL:', error);
    res.status(500).json({ message: 'Failed to generate auth URL' });
  }
});

/**
 * Handle TikTok OAuth callback
 */
router.post('/tiktok/callback', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ message: 'Authorization code required' });
    }

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI || `${process.env.FRONTEND_ORIGIN}/dashboard/social/tiktok/callback`;

    // Exchange code for access token
    const axios = require('axios');
    const tokenResponse = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });

    const { access_token, refresh_token, expires_in, open_id } = tokenResponse.data.data;

    // Get user profile
    const tiktokService = new TikTokService(access_token);
    const profile = await tiktokService.getUserProfile();

    // Check if connection already exists
    let connection = await SocialMediaConnection.findOne({
      user: req.user.id,
      platform: 'tiktok'
    });

    if (connection) {
      connection.accessToken = access_token;
      connection.refreshToken = refresh_token;
      connection.tokenExpiresAt = new Date(Date.now() + expires_in * 1000);
      connection.platformUserId = open_id || profile.open_id;
      connection.platformUsername = profile.display_name;
      connection.platformProfilePicture = profile.avatar_url;
      connection.isActive = true;
      await connection.save();
    } else {
      connection = new SocialMediaConnection({
        user: req.user.id,
        platform: 'tiktok',
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
        platformUserId: open_id || profile.open_id,
        platformUsername: profile.display_name,
        platformProfilePicture: profile.avatar_url
      });
      await connection.save();
    }

    res.json({
      success: true,
      message: 'TikTok account connected successfully',
      connection: {
        id: connection._id,
        platform: connection.platform,
        username: connection.platformUsername,
        isActive: connection.isActive
      }
    });
  } catch (error) {
    console.error('Error handling TikTok callback:', error.response?.data || error.message);
    res.status(500).json({ 
      message: 'Failed to connect TikTok account',
      error: error.response?.data || error.message 
    });
  }
});

/**
 * Get OAuth URL for Twitter/X
 */
router.get('/twitter/auth-url', authenticateToken, (req, res) => {
  try {
    const clientId = process.env.TWITTER_CLIENT_ID;
    const redirectUri = process.env.TWITTER_REDIRECT_URI || `${process.env.FRONTEND_ORIGIN}/dashboard/social/twitter/callback`;
    const scope = 'tweet.read users.read offline.access';
    const state = Buffer.from(JSON.stringify({ userId: req.user.id })).toString('base64');
    const codeChallenge = 'challenge'; // In production, use PKCE
    
    if (!clientId) {
      return res.status(500).json({ 
        message: 'Twitter Client ID not configured' 
      });
    }

    const authUrl = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}&code_challenge=${codeChallenge}&code_challenge_method=plain`;
    
    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating Twitter auth URL:', error);
    res.status(500).json({ message: 'Failed to generate auth URL' });
  }
});

/**
 * Handle Twitter/X OAuth callback
 */
router.post('/twitter/callback', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ message: 'Authorization code required' });
    }

    const clientId = process.env.TWITTER_CLIENT_ID;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET;
    const redirectUri = process.env.TWITTER_REDIRECT_URI || `${process.env.FRONTEND_ORIGIN}/dashboard/social/twitter/callback`;

    // Exchange code for access token
    const axios = require('axios');
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenResponse = await axios.post('https://api.twitter.com/2/oauth2/token',
      new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: 'challenge' // In production, use actual PKCE verifier
      }),
      {
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Get user profile
    const twitterService = new TwitterService(access_token);
    const profile = await twitterService.getUserProfile();

    // Check if connection already exists
    let connection = await SocialMediaConnection.findOne({
      user: req.user.id,
      platform: 'twitter'
    });

    if (connection) {
      connection.accessToken = access_token;
      connection.refreshToken = refresh_token;
      connection.tokenExpiresAt = new Date(Date.now() + expires_in * 1000);
      connection.platformUserId = profile.id;
      connection.platformUsername = profile.username;
      connection.platformProfilePicture = profile.profile_image_url;
      connection.isActive = true;
      await connection.save();
    } else {
      connection = new SocialMediaConnection({
        user: req.user.id,
        platform: 'twitter',
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
        platformUserId: profile.id,
        platformUsername: profile.username,
        platformProfilePicture: profile.profile_image_url
      });
      await connection.save();
    }

    res.json({
      success: true,
      message: 'Twitter account connected successfully',
      connection: {
        id: connection._id,
        platform: connection.platform,
        username: connection.platformUsername,
        isActive: connection.isActive
      }
    });
  } catch (error) {
    console.error('Error handling Twitter callback:', error.response?.data || error.message);
    res.status(500).json({ 
      message: 'Failed to connect Twitter account',
      error: error.response?.data || error.message 
    });
  }
});

/**
 * Get OAuth URL for Facebook Page
 */
router.get('/facebook-page/auth-url', authenticateToken, (req, res) => {
  try {
    const appId = process.env.FACEBOOK_APP_ID;
    const redirectUri = process.env.FACEBOOK_PAGE_REDIRECT_URI || `${process.env.FRONTEND_ORIGIN}/dashboard/social/facebook-page/callback`;
    const scope = 'pages_read_engagement,pages_read_user_content,pages_show_list';
    
    if (!appId) {
      return res.status(500).json({ 
        message: 'Facebook App ID not configured' 
      });
    }

    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code&state=${req.user.id}`;
    
    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating Facebook Page auth URL:', error);
    res.status(500).json({ message: 'Failed to generate auth URL' });
  }
});

/**
 * Handle Facebook Page OAuth callback
 */
router.post('/facebook-page/callback', authenticateToken, async (req, res) => {
  try {
    const { code, pageId } = req.body;
    
    if (!code) {
      return res.status(400).json({ message: 'Authorization code required' });
    }

    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    const redirectUri = process.env.FACEBOOK_PAGE_REDIRECT_URI || `${process.env.FRONTEND_ORIGIN}/dashboard/social/facebook-page/callback`;

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
    const expiresIn = longLivedResponse.data.expires_in || 5184000;

    // Get page access token (if pageId provided)
    let pageAccessToken = longLivedToken;
    let selectedPageId = pageId;
    
    if (pageId) {
      // Get pages user manages
      const pagesResponse = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
        params: {
          access_token: longLivedToken
        }
      });
      
      const page = pagesResponse.data.data.find(p => p.id === pageId);
      if (page) {
        pageAccessToken = page.access_token;
        selectedPageId = page.id;
      }
    } else {
      // Get first page if no pageId specified
      const pagesResponse = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
        params: {
          access_token: longLivedToken
        }
      });
      
      if (pagesResponse.data.data && pagesResponse.data.data.length > 0) {
        const firstPage = pagesResponse.data.data[0];
        pageAccessToken = firstPage.access_token;
        selectedPageId = firstPage.id;
      }
    }

    // Get page profile
    const facebookPageService = new FacebookPageService(pageAccessToken);
    const profile = await facebookPageService.getPageProfile(selectedPageId);

    // Check if connection already exists for this page
    let connection = await SocialMediaConnection.findOne({
      user: req.user.id,
      platform: 'facebook_page',
      platformUserId: selectedPageId
    });

    if (connection) {
      connection.accessToken = pageAccessToken;
      connection.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
      connection.platformUserId = selectedPageId;
      connection.platformUsername = profile.name;
      connection.platformProfilePicture = profile.picture?.data?.url;
      connection.isActive = true;
      await connection.save();
    } else {
      connection = new SocialMediaConnection({
        user: req.user.id,
        platform: 'facebook_page',
        accessToken: pageAccessToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        platformUserId: selectedPageId,
        platformUsername: profile.name,
        platformProfilePicture: profile.picture?.data?.url
      });
      await connection.save();
    }

    res.json({
      success: true,
      message: 'Facebook Page connected successfully',
      connection: {
        id: connection._id,
        platform: connection.platform,
        username: connection.platformUsername,
        isActive: connection.isActive
      }
    });
  } catch (error) {
    console.error('Error handling Facebook Page callback:', error.response?.data || error.message);
    res.status(500).json({ 
      message: 'Failed to connect Facebook Page',
      error: error.response?.data || error.message 
    });
  }
});

/**
 * Get user's Facebook Pages (for selection)
 */
router.get('/facebook-page/pages', authenticateToken, async (req, res) => {
  try {
    // This requires a user access token first
    // In a real implementation, you'd store a user token temporarily
    // For now, return an error suggesting to use the callback flow
    res.status(400).json({ 
      message: 'Please use the OAuth flow to connect a Facebook Page' 
    });
  } catch (error) {
    console.error('Error fetching Facebook Pages:', error);
    res.status(500).json({ message: 'Failed to fetch Facebook Pages' });
  }
});

/**
 * Webhook endpoint for platforms that support webhooks
 */
router.post('/webhook/:platform', async (req, res) => {
  try {
    const { platform } = req.params;
    
    // Verify webhook signature (platform-specific)
    // For now, just acknowledge receipt
    // In production, verify signatures from each platform
    
    // Process webhook data asynchronously
    setImmediate(async () => {
      try {
        // Find connections for this platform and trigger sync
        const connections = await SocialMediaConnection.find({
          platform,
          isActive: true,
          autoSync: true
        });
        
        for (const connection of connections) {
          try {
            if (platform === 'instagram') {
              await syncInstagramPosts(connection);
            } else if (platform === 'facebook' || platform === 'facebook_page') {
              if (platform === 'facebook') {
                await syncFacebookPosts(connection);
              } else {
                await syncFacebookPagePosts(connection);
              }
            }
            // Add other platforms as needed
          } catch (error) {
            console.error(`Error processing webhook for connection ${connection._id}:`, error);
          }
        }
      } catch (error) {
        console.error('Error processing webhook:', error);
      }
    });
    
    // Return 200 immediately to acknowledge receipt
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).json({ message: 'Webhook processing error' });
  }
});

module.exports = router;

