const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Load all models to register schemas
require('./models/User');
require('./models/Folder');
require('./models/Media');
require('./models/Notification');

const Notification = require('./models/Notification');
const User = require('./models/User');
const Media = require('./models/Media');

async function debugNotifications() {
  try {
    console.log('🔍 Debugging Notification System...\n');

    // Check if we have any notifications
    const notificationCount = await Notification.countDocuments();
    console.log(`Total notifications in database: ${notificationCount}`);

    if (notificationCount === 0) {
      console.log('❌ No notifications found in database');
      console.log('💡 Try sharing some media first to create notifications');
      return;
    }

    // Get all notifications
    const notifications = await Notification.find()
      .populate('recipient', 'email')
      .populate('sender', 'email')
      .populate('media', 'fileName originalName')
      .populate('folder', 'name')
      .sort({ createdAt: -1 })
      .limit(10);

    console.log('\n📋 Recent Notifications:');
    notifications.forEach((notification, index) => {
      console.log(`\n${index + 1}. Notification ID: ${notification._id}`);
      console.log(`   Type: ${notification.type}`);
      console.log(`   Title: ${notification.title}`);
      console.log(`   Recipient: ${notification.recipient?.email || 'Unknown'}`);
      console.log(`   Sender: ${notification.sender?.email || 'Unknown'}`);
      console.log(`   Media: ${notification.media?.originalName || notification.media?.fileName || 'No media'}`);
      console.log(`   Folder: ${notification.folder?.name || 'No folder'}`);
      console.log(`   View Once: ${notification.viewOnce}`);
      console.log(`   Is Read: ${notification.isRead}`);
      console.log(`   Is Viewed: ${notification.isViewed}`);
      console.log(`   Created: ${notification.createdAt}`);
    });

    // Test notification viewing for the first notification
    if (notifications.length > 0) {
      const testNotification = notifications[0];
      console.log(`\n🧪 Testing notification viewing for ID: ${testNotification._id}`);
      
      try {
        // Test the markAsViewed method
        console.log('Testing markAsViewed method...');
        await testNotification.markAsViewed();
        console.log('✅ markAsViewed method works');
        
        // Reset for next test
        testNotification.isViewed = false;
        testNotification.viewedAt = undefined;
        await testNotification.save();
        console.log('✅ Notification reset for next test');
        
      } catch (error) {
        console.error('❌ Error testing markAsViewed:', error);
      }
    }

    // Check for any invalid ObjectIds
    console.log('\n🔍 Checking for invalid ObjectIds...');
    const invalidNotifications = await Notification.find({
      $or: [
        { recipient: { $exists: false } },
        { sender: { $exists: false } },
        { media: { $exists: false } },
        { folder: { $exists: false } }
      ]
    });
    
    if (invalidNotifications.length > 0) {
      console.log(`❌ Found ${invalidNotifications.length} notifications with missing references`);
      invalidNotifications.forEach(notification => {
        console.log(`   - ${notification._id}: missing references`);
      });
    } else {
      console.log('✅ All notifications have valid references');
    }

  } catch (error) {
    console.error('❌ Debug failed:', error);
  } finally {
    mongoose.connection.close();
  }
}

debugNotifications();
