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
        }
        results.push({ connectionId: connection._id, platform: connection.platform, ...result });
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

module.exports = {
  InstagramService,
  FacebookService,
  syncInstagramPosts,
  syncFacebookPosts,
  syncAllConnections
};

