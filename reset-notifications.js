const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const Notification = require('./models/Notification');
const User = require('./models/User');

async function resetNotifications() {
  try {
    console.log('🔄 Resetting Notifications...\n');

    // Get a user to test with
    const users = await User.find();
    if (users.length === 0) {
      console.log('❌ No users found');
      return;
    }

    const testUser = users[0];
    console.log(`Using test user: ${testUser.email}`);

    // Find notifications for this user
    const notifications = await Notification.find({
      recipient: testUser._id
    });

    console.log(`Found ${notifications.length} notifications for ${testUser.email}`);

    if (notifications.length === 0) {
      console.log('No notifications found for this user');
      return;
    }

    // Reset the first notification to unviewed
    const notificationToReset = notifications[0];
    console.log(`\nResetting notification: ${notificationToReset._id}`);
    console.log(`Current state: isViewed=${notificationToReset.isViewed}, isRead=${notificationToReset.isRead}`);

    notificationToReset.isViewed = false;
    notificationToReset.isRead = false;
    notificationToReset.viewedAt = null;
    
    await notificationToReset.save();

    console.log(`✅ Notification reset successfully`);
    console.log(`New state: isViewed=${notificationToReset.isViewed}, isRead=${notificationToReset.isRead}`);

    // Test the shared-media endpoint
    console.log('\n🧪 Testing shared-media endpoint...');
    const unviewedNotifications = await Notification.find({
      recipient: testUser._id,
      type: { $in: ['media_shared', 'media_view_once'] },
      isViewed: false
    })
    .populate('sender', 'email')
    .populate('media', 'fileName filePath fileType originalName')
    .populate('folder', 'name')
    .sort({ createdAt: -1 });

    console.log(`Found ${unviewedNotifications.length} unviewed notifications for ${testUser.email}`);
    
    unviewedNotifications.forEach((notification, index) => {
      console.log(`\n${index + 1}. ID: ${notification._id}`);
      console.log(`   Type: ${notification.type}`);
      console.log(`   Title: ${notification.title}`);
      console.log(`   Sender: ${notification.sender?.email || 'Unknown'}`);
      console.log(`   Media: ${notification.media?.originalName || 'No media'}`);
      console.log(`   Folder: ${notification.folder?.name || 'No folder'}`);
      console.log(`   View Once: ${notification.viewOnce}`);
      console.log(`   Is Viewed: ${notification.isViewed}`);
    });

  } catch (error) {
    console.error('❌ Error resetting notifications:', error);
  } finally {
    mongoose.connection.close();
  }
}

resetNotifications();
