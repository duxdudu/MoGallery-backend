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

async function createWorkingNotification() {
  try {
    console.log('🧪 Creating Working Notification...\n');

    // Get users
    const users = await User.find();
    if (users.length < 2) {
      console.log('❌ Need at least 2 users to create a test notification');
      return;
    }

    // Get folders that users own
    const folders = await Folder.find().populate('owner', 'email');
    console.log('Available folders:');
    folders.forEach(folder => {
      console.log(`   ${folder.name} (owner: ${folder.owner.email})`);
    });

    // Find a folder owned by the first user
    const ownerUser = users[0];
    const recipientUser = users[1];
    
    console.log(`\nOwner: ${ownerUser.email}`);
    console.log(`Recipient: ${recipientUser.email}`);

    // Find or create a folder owned by the first user
    let testFolder = await Folder.findOne({ owner: ownerUser._id });
    
    if (!testFolder) {
      console.log('Creating test folder...');
      testFolder = new Folder({
        name: 'Test Folder',
        owner: ownerUser._id
      });
      await testFolder.save();
      console.log(`✅ Created test folder: ${testFolder.name}`);
    } else {
      console.log(`✅ Using existing folder: ${testFolder.name}`);
    }

    // Share the folder with the recipient
    const isAlreadyShared = testFolder.sharedWith.some(share => 
      share.user.toString() === recipientUser._id.toString()
    );

    if (!isAlreadyShared) {
      testFolder.sharedWith.push({
        user: recipientUser._id,
        permission: 'view'
      });
      await testFolder.save();
      console.log(`✅ Shared folder with ${recipientUser.email}`);
    } else {
      console.log(`✅ Folder already shared with ${recipientUser.email}`);
    }

    // Find or create media in this folder
    let testMedia = await Media.findOne({ folder: testFolder._id });
    
    if (!testMedia) {
      console.log('Creating test media...');
      testMedia = new Media({
        fileName: 'test-image.jpg',
        filePath: 'https://via.placeholder.com/300x200.jpg',
        cloudinaryId: 'test-image-123',
        fileType: 'image',
        owner: ownerUser._id,
        folder: testFolder._id
      });
      await testMedia.save();
      console.log(`✅ Created test media: ${testMedia.fileName}`);
    } else {
      console.log(`✅ Using existing media: ${testMedia.fileName}`);
    }

    // Create a test notification
    console.log('\nCreating test notification...');
    const testNotification = await Notification.createMediaShareNotification({
      recipientId: recipientUser._id,
      senderId: ownerUser._id,
      mediaId: testMedia._id,
      folderId: testFolder._id,
      viewOnce: true,
      message: 'Test notification - this should work!'
    });

    console.log('\n✅ Test notification created successfully!');
    console.log(`   ID: ${testNotification._id}`);
    console.log(`   Title: ${testNotification.title}`);
    console.log(`   Type: ${testNotification.type}`);
    console.log(`   View Once: ${testNotification.viewOnce}`);
    console.log(`   Is Viewed: ${testNotification.isViewed}`);

    // Test the shared-media endpoint for the recipient
    console.log('\n🧪 Testing shared-media endpoint for recipient...');
    const notifications = await Notification.find({
      recipient: recipientUser._id,
      type: { $in: ['media_shared', 'media_view_once'] },
      isViewed: false
    })
    .populate('sender', 'email')
    .populate('media', 'fileName filePath fileType originalName')
    .populate('folder', 'name')
    .sort({ createdAt: -1 });

    console.log(`Found ${notifications.length} unviewed notifications for ${recipientUser.email}`);
    
    notifications.forEach((notification, index) => {
      console.log(`\n${index + 1}. ID: ${notification._id}`);
      console.log(`   Type: ${notification.type}`);
      console.log(`   Title: ${notification.title}`);
      console.log(`   Sender: ${notification.sender?.email || 'Unknown'}`);
      console.log(`   Media: ${notification.media?.fileName || 'No media'}`);
      console.log(`   Folder: ${notification.folder?.name || 'No folder'}`);
      console.log(`   View Once: ${notification.viewOnce}`);
      console.log(`   Is Viewed: ${notification.isViewed}`);
    });

    console.log(`\n🎉 Test completed! User ${recipientUser.email} should now see notifications.`);

  } catch (error) {
    console.error('❌ Error creating working notification:', error);
  } finally {
    mongoose.connection.close();
  }
}

createWorkingNotification();










