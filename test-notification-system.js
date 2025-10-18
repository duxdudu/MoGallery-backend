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

async function testNotificationSystem() {
  try {
    console.log('🧪 Testing Notification System...\n');

    // Check if we have any users
    const userCount = await User.countDocuments();
    console.log(`Total users in database: ${userCount}`);

    if (userCount === 0) {
      console.log('❌ No users found. Please create some users first.');
      return;
    }

    // Get a sample user
    const sampleUser = await User.findOne();
    console.log(`Using sample user: ${sampleUser.email}`);

    // Check if we have any media
    const mediaCount = await Media.countDocuments();
    console.log(`Total media in database: ${mediaCount}`);

    if (mediaCount === 0) {
      console.log('❌ No media found. Please upload some media first.');
      return;
    }

    // Get a sample media
    const sampleMedia = await Media.findOne().populate('folder');
    console.log(`Using sample media: ${sampleMedia.originalName} in folder: ${sampleMedia.folder.name}`);

    // Check existing notifications
    const notificationCount = await Notification.countDocuments();
    console.log(`\nTotal notifications in database: ${notificationCount}`);

    if (notificationCount > 0) {
      console.log('\n📋 Existing Notifications:');
      const notifications = await Notification.find()
        .populate('recipient', 'email')
        .populate('sender', 'email')
        .populate('media', 'originalName')
        .populate('folder', 'name')
        .sort({ createdAt: -1 })
        .limit(5);

      notifications.forEach((notification, index) => {
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

      // Test viewing the first notification
      if (notifications.length > 0) {
        const testNotification = notifications[0];
        console.log(`\n🧪 Testing notification viewing for ID: ${testNotification._id}`);
        
        try {
          // Test the markAsViewed method
          console.log('Testing markAsViewed method...');
          await testNotification.markAsViewed();
          console.log('✅ markAsViewed method works');
          
          // Check if the notification was marked as viewed
          const updatedNotification = await Notification.findById(testNotification._id);
          console.log(`✅ Notification is now viewed: ${updatedNotification.isViewed}`);
          console.log(`✅ Viewed at: ${updatedNotification.viewedAt}`);
          
        } catch (error) {
          console.error('❌ Error testing markAsViewed:', error);
        }
      }
    } else {
      console.log('💡 No notifications found. Try sharing some media to create notifications.');
    }

    // Test creating a new notification
    console.log('\n🧪 Testing notification creation...');
    try {
      const newNotification = await Notification.createMediaShareNotification({
        recipientId: sampleUser._id,
        senderId: sampleUser._id,
        mediaId: sampleMedia._id,
        folderId: sampleMedia.folder._id,
        viewOnce: true,
        message: 'Test notification from system test'
      });
      
      console.log('✅ Successfully created test notification');
      console.log(`   ID: ${newNotification._id}`);
      console.log(`   Title: ${newNotification.title}`);
      console.log(`   Type: ${newNotification.type}`);
      
      // Clean up the test notification
      await Notification.findByIdAndDelete(newNotification._id);
      console.log('✅ Test notification cleaned up');
      
    } catch (error) {
      console.error('❌ Error creating test notification:', error);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    mongoose.connection.close();
  }
}

testNotificationSystem();
