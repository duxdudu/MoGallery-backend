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

async function createTestNotification() {
  try {
    console.log('🧪 Creating Test Notification...\n');

    // Get users
    const users = await User.find();
    if (users.length < 2) {
      console.log('❌ Need at least 2 users to create a test notification');
      return;
    }

    // Get media
    const media = await Media.find().populate('folder');
    if (media.length === 0) {
      console.log('❌ No media found to create notification for');
      return;
    }

    const sender = users[0];
    const recipient = users[1];
    const testMedia = media[0];

    console.log(`Sender: ${sender.email}`);
    console.log(`Recipient: ${recipient.email}`);
    console.log(`Media: ${testMedia.originalName} in folder ${testMedia.folder?.name}`);

    // Create a test notification
    const testNotification = await Notification.createMediaShareNotification({
      recipientId: recipient._id,
      senderId: sender._id,
      mediaId: testMedia._id,
      folderId: testMedia.folder._id,
      viewOnce: true,
      message: 'Test notification - please view this media'
    });

    console.log('\n✅ Test notification created successfully!');
    console.log(`   ID: ${testNotification._id}`);
    console.log(`   Title: ${testNotification.title}`);
    console.log(`   Type: ${testNotification.type}`);
    console.log(`   View Once: ${testNotification.viewOnce}`);
    console.log(`   Is Viewed: ${testNotification.isViewed}`);

    // Test the shared-media endpoint
    console.log('\n🧪 Testing shared-media endpoint...');
    const notifications = await Notification.find({
      recipient: recipient._id,
      type: { $in: ['media_shared', 'media_view_once'] },
      isViewed: false
    })
    .populate('sender', 'email')
    .populate('media', 'fileName filePath fileType originalName')
    .populate('folder', 'name')
    .sort({ createdAt: -1 });

    console.log(`Found ${notifications.length} unviewed notifications for ${recipient.email}`);
    
    notifications.forEach((notification, index) => {
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
    console.error('❌ Error creating test notification:', error);
  } finally {
    mongoose.connection.close();
  }
}

createTestNotification();
