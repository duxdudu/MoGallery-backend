const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const Notification = require('./models/Notification');
const User = require('./models/User');
const Media = require('./models/Media');
const Folder = require('./models/Folder');

async function testNotifications() {
  try {
    console.log('🔍 Testing Notification System...\n');

    // Check if we have any users
    const userCount = await User.countDocuments();
    console.log(`Total users in database: ${userCount}`);

    if (userCount === 0) {
      console.log('❌ No users found. Please create some users first.');
      return;
    }

    // Get all users
    const users = await User.find();
    console.log('Users:', users.map(u => u.email));

    // Check if we have any media
    const mediaCount = await Media.countDocuments();
    console.log(`Total media in database: ${mediaCount}`);

    if (mediaCount === 0) {
      console.log('❌ No media found. Please upload some media first.');
      return;
    }

    // Get all media with folders
    const media = await Media.find().populate('folder');
    console.log('Media:', media.map(m => `${m.originalName} in folder ${m.folder?.name}`));

    // Check existing notifications
    const notificationCount = await Notification.countDocuments();
    console.log(`\nTotal notifications in database: ${notificationCount}`);

    if (notificationCount > 0) {
      console.log('\n📋 All Notifications:');
      const allNotifications = await Notification.find()
        .populate('recipient', 'email')
        .populate('sender', 'email')
        .populate('media', 'originalName')
        .populate('folder', 'name')
        .sort({ createdAt: -1 });

      allNotifications.forEach((notification, index) => {
        console.log(`\n${index + 1}. ID: ${notification._id}`);
        console.log(`   Type: ${notification.type}`);
        console.log(`   Title: ${notification.title}`);
        console.log(`   Recipient: ${notification.recipient?.email || 'Unknown'}`);
        console.log(`   Sender: ${notification.sender?.email || 'Unknown'}`);
        console.log(`   Media: ${notification.media?.originalName || 'No media'}`);
        console.log(`   Folder: ${notification.folder?.name || 'No folder'}`);
        console.log(`   View Once: ${notification.viewOnce}`);
        console.log(`   Is Read: ${notification.isRead}`);
        console.log(`   Is Viewed: ${notification.isViewed}`);
        console.log(`   Created: ${notification.createdAt}`);
      });

      // Test the shared-media endpoint logic
      console.log('\n🧪 Testing shared-media endpoint logic...');
      for (const user of users) {
        console.log(`\nTesting for user: ${user.email}`);
        
        const notifications = await Notification.find({
          recipient: user._id,
          type: { $in: ['media_shared', 'media_view_once'] },
          $or: [
            { isViewed: false },
            { viewOnce: false }
          ]
        })
        .populate('sender', 'email')
        .populate('media', 'fileName filePath fileType originalName')
        .populate('folder', 'name')
        .sort({ createdAt: -1 })
        .limit(20);

        console.log(`Found ${notifications.length} notifications for ${user.email}`);
        
        // Test the cleanup logic
        const validNotifications = [];
        for (const notification of notifications) {
          let isValid = true;
          
          if (notification.media && notification.folder) {
            try {
              const media = await Media.findById(notification.media._id);
              const folder = await Folder.findById(notification.folder._id);
              
              if (!media || !folder) {
                console.log(`  ❌ Notification ${notification._id} - media or folder not found`);
                isValid = false;
              } else if (!folder.hasAccess(user._id)) {
                console.log(`  ❌ Notification ${notification._id} - user no longer has folder access`);
                isValid = false;
              } else if (!media.canView(user._id)) {
                console.log(`  ❌ Notification ${notification._id} - user can no longer view media`);
                isValid = false;
              } else {
                console.log(`  ✅ Notification ${notification._id} - valid`);
              }
            } catch (error) {
              console.error(`  ❌ Error checking notification ${notification._id}:`, error);
            }
          }
          
          if (isValid) {
            validNotifications.push(notification);
          }
        }
        
        console.log(`After cleanup: ${validNotifications.length} valid notifications for ${user.email}`);
      }
    } else {
      console.log('💡 No notifications found. Try sharing some media to create notifications.');
      
      // Try to create a test notification
      if (users.length >= 2 && media.length > 0) {
        console.log('\n🧪 Creating test notification...');
        try {
          const testNotification = await Notification.createMediaShareNotification({
            recipientId: users[1]._id,
            senderId: users[0]._id,
            mediaId: media[0]._id,
            folderId: media[0].folder._id,
            viewOnce: true,
            message: 'Test notification from system test'
          });
          
          console.log('✅ Successfully created test notification');
          console.log(`   ID: ${testNotification._id}`);
          console.log(`   Title: ${testNotification.title}`);
          console.log(`   Type: ${testNotification.type}`);
          
        } catch (error) {
          console.error('❌ Error creating test notification:', error);
        }
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    mongoose.connection.close();
  }
}

testNotifications();
