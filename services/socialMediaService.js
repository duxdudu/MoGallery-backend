const axios = require('axios');
const SocialMediaConnection = require('../models/SocialMediaConnection');
const Media = require('../models/Media');
const Folder = require('../models/Folder');
const { uploadToCloudinary } = require('../config/cloudinary');

/**
 * Instagram API Service
 */
class InstagramService {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.baseURL = 'https://graph.instagram.com';
  }

  async getUserProfile() {
    try {
      const response = await axios.get(`${this.baseURL}/me`, {
        params: {
          fields: 'id,username,account_type,media_count',
          access_token: this.accessToken
        }
      });
      return response.data;
    } catch (error) {
      console.error('Instagram API Error (getUserProfile):', error.response?.data || error.message);
      throw error;
    }
  }

  async getUserMedia(limit = 25, after = null) {
    try {
      const params = {
        fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
        limit,
        access_token: this.accessToken
      };
      
      if (after) {
        params.after = after;
      }

      const response = await axios.get(`${this.baseURL}/me/media`, { params });
      return response.data;
    } catch (error) {
      console.error('Instagram API Error (getUserMedia):', error.response?.data || error.message);
      throw error;
    }
  }

  async refreshAccessToken(refreshToken) {
    try {
      const response = await axios.get(`${this.baseURL}/refresh_access_token`, {
        params: {
          grant_type: 'ig_refresh_token',
          access_token: refreshToken
        }
      });
      return response.data;
    } catch (error) {
      console.error('Instagram Token Refresh Error:', error.response?.data || error.message);
      throw error;
    }
  }
}

/**
 * Facebook API Service
 */
class FacebookService {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.baseURL = 'https://graph.facebook.com/v18.0';
  }

  async getUserProfile() {
    try {
      const response = await axios.get(`${this.baseURL}/me`, {
        params: {
          fields: 'id,name,picture',
          access_token: this.accessToken
        }
      });
      return response.data;
    } catch (error) {
      console.error('Facebook API Error (getUserProfile):', error.response?.data || error.message);
      throw error;
    }
  }

  async getUserPosts(limit = 25, after = null) {
    try {
      const params = {
        fields: 'id,message,created_time,full_picture,picture,permalink_url,type,likes.summary(true),comments.summary(true)',
        limit,
        access_token: this.accessToken
      };
      
      if (after) {
        params.after = after;
      }

      const response = await axios.get(`${this.baseURL}/me/posts`, { params });
      return response.data;
    } catch (error) {
      console.error('Facebook API Error (getUserPosts):', error.response?.data || error.message);
      throw error;
    }
  }

  async refreshAccessToken(appId, appSecret, refreshToken) {
    try {
      const response = await axios.get(`${this.baseURL}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: refreshToken
        }
      });
      return response.data;
    } catch (error) {
      console.error('Facebook Token Refresh Error:', error.response?.data || error.message);
      throw error;
    }
  }
}

/**
 * Download media from URL and upload to Cloudinary
 */
async function downloadAndUploadMedia(url, fileName, fileType) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    
    // Upload to Cloudinary
    const result = await uploadToCloudinary(buffer, {
      folder: 'mogallery/social-memories',
      resource_type: fileType === 'video' ? 'video' : 'image',
      public_id: `social-${Date.now()}-${Math.random().toString(36).substring(7)}`
    });

    return {
      filePath: result.secure_url,
      cloudinaryId: result.public_id
    };
  } catch (error) {
    console.error('Error downloading/uploading media:', error);
    throw error;
  }
}

/**
 * Sync posts from Instagram
 */
async function syncInstagramPosts(connection) {
  try {
    const instagramService = new InstagramService(connection.accessToken);
    
    // Get user media
    const mediaData = await instagramService.getUserMedia(25);
    const posts = mediaData.data || [];
    
    // Get or create memories folder
    let memoriesFolder = connection.memoriesFolder;
    if (!memoriesFolder) {
      memoriesFolder = await Folder.findOne({ 
        owner: connection.user, 
        name: 'Instagram Memories' 
      });
      
      if (!memoriesFolder) {
        memoriesFolder = new Folder({
          name: 'Instagram Memories',
          owner: connection.user
        });
        await memoriesFolder.save();
      }
      
      connection.memoriesFolder = memoriesFolder._id;
      await connection.save();
    } else {
      memoriesFolder = await Folder.findById(memoriesFolder);
    }

    const savedPosts = [];
    let newPostsCount = 0;

    for (const post of posts) {
      // Skip if already synced
      if (connection.lastPostId && post.id === connection.lastPostId) {
        break;
      }

      try {
        // Determine media type
        const isVideo = post.media_type === 'VIDEO';
        const mediaUrl = isVideo ? post.media_url : (post.media_url || post.thumbnail_url);
        
        if (!mediaUrl) continue;

        // Download and upload to Cloudinary
        const { filePath, cloudinaryId } = await downloadAndUploadMedia(
          mediaUrl,
          `instagram-${post.id}.${isVideo ? 'mp4' : 'jpg'}`,
          isVideo ? 'video' : 'image'
        );

        // Create media entry
        const media = new Media({
          fileName: `Instagram Post - ${post.id}`,
          filePath,
          cloudinaryId,
          fileType: isVideo ? 'video' : 'image',
          owner: connection.user,
          folder: memoriesFolder._id,
          size: 0, // Size will be calculated by Cloudinary
          platform: 'instagram',
          platformPostId: post.id,
          syncedAutomatically: true,
          // Store metadata
          metadata: {
            platform: 'instagram',
            platformPostId: post.id,
            caption: post.caption,
            permalink: post.permalink,
            timestamp: post.timestamp,
            likes: post.like_count,
            comments: post.comments_count
          }
        });

        await media.save();
        savedPosts.push(media);
        newPostsCount++;

        // Update lastPostId if this is the first new post
        if (!connection.lastPostId) {
          connection.lastPostId = post.id;
        }
      } catch (error) {
        console.error(`Error syncing Instagram post ${post.id}:`, error);
        continue;
      }
    }

    // Update last sync time
    connection.lastSyncAt = new Date();
    await connection.save();

    return {
      success: true,
      newPostsCount,
      savedPosts: savedPosts.length
    };
  } catch (error) {
    console.error('Error syncing Instagram posts:', error);
    throw error;
  }
}

/**
 * Sync posts from Facebook
 */
async function syncFacebookPosts(connection) {
  try {
    const facebookService = new FacebookService(connection.accessToken);
    
    // Get user posts
    const postsData = await facebookService.getUserPosts(25);
    const posts = postsData.data || [];
    
    // Get or create memories folder
    let memoriesFolder = connection.memoriesFolder;
    if (!memoriesFolder) {
      memoriesFolder = await Folder.findOne({ 
        owner: connection.user, 
        name: 'Facebook Memories' 
      });
      
      if (!memoriesFolder) {
        memoriesFolder = new Folder({
          name: 'Facebook Memories',
          owner: connection.user
        });
        await memoriesFolder.save();
      }
      
      connection.memoriesFolder = memoriesFolder._id;
      await connection.save();
    } else {
      memoriesFolder = await Folder.findById(memoriesFolder);
    }

    const savedPosts = [];
    let newPostsCount = 0;

    for (const post of posts) {
      // Skip if already synced
      if (connection.lastPostId && post.id === connection.lastPostId) {
        break;
      }

      try {
        // Only process posts with images
        const imageUrl = post.full_picture || post.picture;
        if (!imageUrl) continue;

        // Determine if it's a video (Facebook posts can have videos)
        const isVideo = post.type === 'video';

        // Download and upload to Cloudinary
        const { filePath, cloudinaryId } = await downloadAndUploadMedia(
          imageUrl,
          `facebook-${post.id}.${isVideo ? 'mp4' : 'jpg'}`,
          isVideo ? 'video' : 'image'
        );

        // Create media entry
        const media = new Media({
          fileName: `Facebook Post - ${post.id}`,
          filePath,
          cloudinaryId,
          fileType: isVideo ? 'video' : 'image',
          owner: connection.user,
          folder: memoriesFolder._id,
          size: 0,
          platform: 'facebook',
          platformPostId: post.id,
          syncedAutomatically: true,
          // Store metadata
          metadata: {
            platform: 'facebook',
            platformPostId: post.id,
            message: post.message,
            permalink: post.permalink_url,
            timestamp: post.created_time,
            likes: post.likes?.summary?.total_count || 0,
            comments: post.comments?.summary?.total_count || 0
          }
        });

        await media.save();
        savedPosts.push(media);
        newPostsCount++;

        // Update lastPostId if this is the first new post
        if (!connection.lastPostId) {
          connection.lastPostId = post.id;
        }
      } catch (error) {
        console.error(`Error syncing Facebook post ${post.id}:`, error);
        continue;
      }
    }

    // Update last sync time
    connection.lastSyncAt = new Date();
    await connection.save();

    return {
      success: true,
      newPostsCount,
      savedPosts: savedPosts.length
    };
  } catch (error) {
    console.error('Error syncing Facebook posts:', error);
    throw error;
  }
}

/**
 * TikTok API Service
 */
class TikTokService {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.baseURL = 'https://open.tiktokapis.com/v2';
  }

  async getUserProfile() {
    try {
      const response = await axios.get(`${this.baseURL}/user/info/`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        },
        params: {
          fields: 'open_id,union_id,avatar_url,display_name'
        }
      });
      return response.data.data.user;
    } catch (error) {
      console.error('TikTok API Error (getUserProfile):', error.response?.data || error.message);
      throw error;
    }
  }

  async getUserVideos(limit = 20, cursor = null) {
    try {
      const params = {
        max_count: limit
      };
      if (cursor) params.cursor = cursor;

      const response = await axios.post(`${this.baseURL}/video/list/`, params, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      return response.data.data;
    } catch (error) {
      console.error('TikTok API Error (getUserVideos):', error.response?.data || error.message);
      throw error;
    }
  }

  async refreshAccessToken(clientKey, clientSecret, refreshToken) {
    try {
      const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_key: clientKey,
        client_secret: clientSecret
      });
      return response.data.data;
    } catch (error) {
      console.error('TikTok Token Refresh Error:', error.response?.data || error.message);
      throw error;
    }
  }
}

/**
 * Twitter/X API Service
 */
class TwitterService {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.baseURL = 'https://api.twitter.com/2';
  }

  async getUserProfile() {
    try {
      const response = await axios.get(`${this.baseURL}/users/me`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        },
        params: {
          'user.fields': 'id,name,username,profile_image_url'
        }
      });
      return response.data.data;
    } catch (error) {
      console.error('Twitter API Error (getUserProfile):', error.response?.data || error.message);
      throw error;
    }
  }

  async getUserTweets(userId, limit = 25, paginationToken = null) {
    try {
      const params = {
        max_results: limit,
        'tweet.fields': 'id,text,created_at,attachments,public_metrics',
        'media.fields': 'type,url,preview_image_url',
        expansions: 'attachments.media_keys',
        'user.fields': 'username'
      };
      if (paginationToken) params.pagination_token = paginationToken;

      const response = await axios.get(`${this.baseURL}/users/${userId}/tweets`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        },
        params
      });
      return response.data;
    } catch (error) {
      console.error('Twitter API Error (getUserTweets):', error.response?.data || error.message);
      throw error;
    }
  }

  async refreshAccessToken(clientId, clientSecret, refreshToken) {
    try {
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const response = await axios.post('https://api.twitter.com/2/oauth2/token', 
        new URLSearchParams({
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        }),
        {
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error('Twitter Token Refresh Error:', error.response?.data || error.message);
      throw error;
    }
  }
}

/**
 * Facebook Page API Service
 */
class FacebookPageService {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.baseURL = 'https://graph.facebook.com/v18.0';
  }

  async getPageProfile(pageId) {
    try {
      const response = await axios.get(`${this.baseURL}/${pageId}`, {
        params: {
          fields: 'id,name,picture',
          access_token: this.accessToken
        }
      });
      return response.data;
    } catch (error) {
      console.error('Facebook Page API Error (getPageProfile):', error.response?.data || error.message);
      throw error;
    }
  }

  async getPagePosts(pageId, limit = 25, after = null) {
    try {
      const params = {
        fields: 'id,message,created_time,full_picture,picture,permalink_url,type,likes.summary(true),comments.summary(true)',
        limit,
        access_token: this.accessToken
      };
      if (after) params.after = after;

      const response = await axios.get(`${this.baseURL}/${pageId}/posts`, { params });
      return response.data;
    } catch (error) {
      console.error('Facebook Page API Error (getPagePosts):', error.response?.data || error.message);
      throw error;
    }
  }
}

/**
 * Sync posts from TikTok
 */
async function syncTikTokPosts(connection) {
  try {
    const tiktokService = new TikTokService(connection.accessToken);
    
    // Get user videos
    const videosData = await tiktokService.getUserVideos(25);
    const videos = videosData.videos || [];
    
    // Get or create memories folder
    let memoriesFolder = connection.memoriesFolder;
    if (!memoriesFolder) {
      memoriesFolder = await Folder.findOne({ 
        owner: connection.user, 
        name: 'TikTok Memories' 
      });
      
      if (!memoriesFolder) {
        memoriesFolder = new Folder({
          name: 'TikTok Memories',
          owner: connection.user
        });
        await memoriesFolder.save();
      }
      
      connection.memoriesFolder = memoriesFolder._id;
      await connection.save();
    } else {
      memoriesFolder = await Folder.findById(memoriesFolder);
    }

    const savedPosts = [];
    let newPostsCount = 0;

    for (const video of videos) {
      // Skip if already synced
      if (connection.lastPostId && video.id === connection.lastPostId) {
        break;
      }

      try {
        const videoUrl = video.video_url || video.cover_image_url;
        if (!videoUrl) continue;

        // Download and upload to Cloudinary
        const { filePath, cloudinaryId } = await downloadAndUploadMedia(
          videoUrl,
          `tiktok-${video.id}.mp4`,
          'video'
        );

        // Create media entry
        const media = new Media({
          fileName: `TikTok Video - ${video.id}`,
          filePath,
          cloudinaryId,
          fileType: 'video',
          owner: connection.user,
          folder: memoriesFolder._id,
          size: 0,
          platform: 'tiktok',
          platformPostId: video.id,
          syncedAutomatically: true,
          metadata: {
            platform: 'tiktok',
            platformPostId: video.id,
            caption: video.title || video.description,
            timestamp: video.create_time,
            viewCount: video.view_count,
            likeCount: video.like_count,
            shareCount: video.share_count
          }
        });

        await media.save();
        savedPosts.push(media);
        newPostsCount++;

        if (!connection.lastPostId) {
          connection.lastPostId = video.id;
        }
      } catch (error) {
        console.error(`Error syncing TikTok video ${video.id}:`, error);
        continue;
      }
    }

    connection.lastSyncAt = new Date();
    await connection.save();

    return {
      success: true,
      newPostsCount,
      savedPosts: savedPosts.length
    };
  } catch (error) {
    console.error('Error syncing TikTok posts:', error);
    throw error;
  }
}

/**
 * Sync posts from Twitter/X
 */
async function syncTwitterPosts(connection) {
  try {
    const twitterService = new TwitterService(connection.accessToken);
    
    // Get user profile first to get user ID
    const profile = await twitterService.getUserProfile();
    const userId = profile.id;
    
    // Get user tweets
    const tweetsData = await twitterService.getUserTweets(userId, 25);
    const tweets = tweetsData.data || [];
    const mediaMap = tweetsData.includes?.media || [];
    
    // Get or create memories folder
    let memoriesFolder = connection.memoriesFolder;
    if (!memoriesFolder) {
      memoriesFolder = await Folder.findOne({ 
        owner: connection.user, 
        name: 'Twitter Memories' 
      });
      
      if (!memoriesFolder) {
        memoriesFolder = new Folder({
          name: 'Twitter Memories',
          owner: connection.user
        });
        await memoriesFolder.save();
      }
      
      connection.memoriesFolder = memoriesFolder._id;
      await connection.save();
    } else {
      memoriesFolder = await Folder.findById(memoriesFolder);
    }

    const savedPosts = [];
    let newPostsCount = 0;

    for (const tweet of tweets) {
      // Skip if already synced
      if (connection.lastPostId && tweet.id === connection.lastPostId) {
        break;
      }

      try {
        // Check if tweet has media attachments
        const mediaKeys = tweet.attachments?.media_keys || [];
        if (mediaKeys.length === 0) continue;

        // Find media for this tweet
        const tweetMedia = mediaMap.filter(m => mediaKeys.includes(m.media_key));
        if (tweetMedia.length === 0) continue;

        // Process first media item (can be extended to handle multiple)
        const mediaItem = tweetMedia[0];
        const mediaUrl = mediaItem.url || mediaItem.preview_image_url;
        if (!mediaUrl) continue;

        const isVideo = mediaItem.type === 'video';
        
        // Download and upload to Cloudinary
        const { filePath, cloudinaryId } = await downloadAndUploadMedia(
          mediaUrl,
          `twitter-${tweet.id}.${isVideo ? 'mp4' : 'jpg'}`,
          isVideo ? 'video' : 'image'
        );

        // Create media entry
        const media = new Media({
          fileName: `Twitter Post - ${tweet.id}`,
          filePath,
          cloudinaryId,
          fileType: isVideo ? 'video' : 'image',
          owner: connection.user,
          folder: memoriesFolder._id,
          size: 0,
          platform: 'twitter',
          platformPostId: tweet.id,
          syncedAutomatically: true,
          metadata: {
            platform: 'twitter',
            platformPostId: tweet.id,
            text: tweet.text,
            timestamp: tweet.created_at,
            likes: tweet.public_metrics?.like_count || 0,
            retweets: tweet.public_metrics?.retweet_count || 0,
            replies: tweet.public_metrics?.reply_count || 0
          }
        });

        await media.save();
        savedPosts.push(media);
        newPostsCount++;

        if (!connection.lastPostId) {
          connection.lastPostId = tweet.id;
        }
      } catch (error) {
        console.error(`Error syncing Twitter tweet ${tweet.id}:`, error);
        continue;
      }
    }

    connection.lastSyncAt = new Date();
    await connection.save();

    return {
      success: true,
      newPostsCount,
      savedPosts: savedPosts.length
    };
  } catch (error) {
    console.error('Error syncing Twitter posts:', error);
    throw error;
  }
}

/**
 * Sync posts from Facebook Page
 */
async function syncFacebookPagePosts(connection) {
  try {
    const facebookPageService = new FacebookPageService(connection.accessToken);
    const pageId = connection.platformUserId;
    
    // Get page posts
    const postsData = await facebookPageService.getPagePosts(pageId, 25);
    const posts = postsData.data || [];
    
    // Get or create memories folder
    let memoriesFolder = connection.memoriesFolder;
    if (!memoriesFolder) {
      memoriesFolder = await Folder.findOne({ 
        owner: connection.user, 
        name: 'Facebook Page Memories' 
      });
      
      if (!memoriesFolder) {
        memoriesFolder = new Folder({
          name: 'Facebook Page Memories',
          owner: connection.user
        });
        await memoriesFolder.save();
      }
      
      connection.memoriesFolder = memoriesFolder._id;
      await connection.save();
    } else {
      memoriesFolder = await Folder.findById(memoriesFolder);
    }

    const savedPosts = [];
    let newPostsCount = 0;

    for (const post of posts) {
      // Skip if already synced
      if (connection.lastPostId && post.id === connection.lastPostId) {
        break;
      }

      try {
        const imageUrl = post.full_picture || post.picture;
        if (!imageUrl) continue;

        const isVideo = post.type === 'video';

        // Download and upload to Cloudinary
        const { filePath, cloudinaryId } = await downloadAndUploadMedia(
          imageUrl,
          `facebook-page-${post.id}.${isVideo ? 'mp4' : 'jpg'}`,
          isVideo ? 'video' : 'image'
        );

        // Create media entry
        const media = new Media({
          fileName: `Facebook Page Post - ${post.id}`,
          filePath,
          cloudinaryId,
          fileType: isVideo ? 'video' : 'image',
          owner: connection.user,
          folder: memoriesFolder._id,
          size: 0,
          platform: 'facebook_page',
          platformPostId: post.id,
          syncedAutomatically: true,
          metadata: {
            platform: 'facebook_page',
            platformPostId: post.id,
            message: post.message,
            permalink: post.permalink_url,
            timestamp: post.created_time,
            likes: post.likes?.summary?.total_count || 0,
            comments: post.comments?.summary?.total_count || 0
          }
        });

        await media.save();
        savedPosts.push(media);
        newPostsCount++;

        if (!connection.lastPostId) {
          connection.lastPostId = post.id;
        }
      } catch (error) {
        console.error(`Error syncing Facebook Page post ${post.id}:`, error);
        continue;
      }
    }

    connection.lastSyncAt = new Date();
    await connection.save();

    return {
      success: true,
      newPostsCount,
      savedPosts: savedPosts.length
    };
  } catch (error) {
    console.error('Error syncing Facebook Page posts:', error);
    throw error;
  }
}

/**
 * Sync all active connections
 */
async function syncAllConnections() {
  try {
    const connections = await SocialMediaConnection.find({ 
      isActive: true, 
      autoSync: true 
    }).populate('user');

    const results = [];

    for (const connection of connections) {
      try {
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
        }
        if (result) {
          results.push({ connectionId: connection._id, platform: connection.platform, ...result });
        }
      } catch (error) {
        console.error(`Error syncing ${connection.platform} for user ${connection.user}:`, error);
        results.push({ 
          connectionId: connection._id, 
          platform: connection.platform, 
          success: false, 
          error: error.message 
        });
      }
    }

    return results;
  } catch (error) {
    console.error('Error syncing all connections:', error);
    throw error;
  }
}

/**
 * Post media to social media platforms
 */
async function postToSocialMedia(media, platforms, caption = '') {
  const results = [];
  const SocialMediaConnection = require('../models/SocialMediaConnection');
  const axios = require('axios');
  
  // Get active connections for specified platforms
  const connections = await SocialMediaConnection.find({
    user: media.owner,
    platform: { $in: platforms },
    isActive: true
  });

  for (const connection of connections) {
    try {
      let postResult = null;
      
      if (connection.platform === 'instagram') {
        // Instagram requires special handling - need to use Instagram Basic Display or Graph API
        // For now, we'll use a simplified approach
        const instagramService = new InstagramService(connection.accessToken);
        // Note: Instagram posting requires additional permissions and setup
        // This is a placeholder for the actual implementation
        postResult = { 
          success: false, 
          message: 'Instagram posting requires additional API setup',
          platform: 'instagram'
        };
      } else if (connection.platform === 'facebook' || connection.platform === 'facebook_page') {
        // Post to Facebook
        const facebookService = connection.platform === 'facebook' 
          ? new FacebookService(connection.accessToken)
          : new FacebookPageService(connection.accessToken);
        
        const pageId = connection.platform === 'facebook_page' ? connection.platformUserId : 'me';
        
        // Upload photo/video to Facebook
        const formData = new URLSearchParams();
        formData.append('url', media.filePath);
        formData.append('caption', caption);
        formData.append('access_token', connection.accessToken);
        
        const response = await axios.post(
          `https://graph.facebook.com/v18.0/${pageId}/photos`,
          formData,
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          }
        );
        
        postResult = {
          success: true,
          platform: connection.platform,
          postId: response.data.id,
          url: `https://www.facebook.com/${response.data.id}`
        };
      } else if (connection.platform === 'twitter') {
        // Post to Twitter/X
        const twitterService = new TwitterService(connection.accessToken);
        
        // Twitter API v2 requires media upload first, then tweet
        // Simplified version - in production, use proper media upload endpoint
        const tweetText = caption || 'Shared from MoGallery';
        
        // For now, return a placeholder
        postResult = {
          success: false,
          message: 'Twitter posting requires media upload API setup',
          platform: 'twitter'
        };
      } else if (connection.platform === 'tiktok') {
        // TikTok posting requires special API setup
        postResult = {
          success: false,
          message: 'TikTok posting requires additional API setup',
          platform: 'tiktok'
        };
      }
      
      if (postResult && postResult.success) {
        // Update media metadata with social media post info
        if (!media.metadata) media.metadata = {};
        if (!media.metadata.socialMediaPosts) media.metadata.socialMediaPosts = [];
        
        media.metadata.socialMediaPosts.push({
          platform: connection.platform,
          postId: postResult.postId,
          url: postResult.url,
          postedAt: new Date()
        });
        
        await media.save();
      }
      
      results.push({
        platform: connection.platform,
        ...postResult
      });
    } catch (error) {
      console.error(`Error posting to ${connection.platform}:`, error);
      results.push({
        platform: connection.platform,
        success: false,
        error: error.message
      });
    }
  }
  
  return results;
}

module.exports = {
  InstagramService,
  FacebookService,
  TikTokService,
  TwitterService,
  FacebookPageService,
  syncInstagramPosts,
  syncFacebookPosts,
  syncTikTokPosts,
  syncTwitterPosts,
  syncFacebookPagePosts,
  syncAllConnections,
  postToSocialMedia
};

