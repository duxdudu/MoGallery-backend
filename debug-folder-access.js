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

async function debugFolderAccess() {
  try {
    console.log('🔍 Debugging Folder Access...\n');

    // Get the notification that's being filtered out
    const notification = await Notification.findById('68b8cf03f0e0ea966fa05829')
      .populate('recipient', 'email')
      .populate('sender', 'email')
      .populate('media')
      .populate('folder');

    if (!notification) {
      console.log('❌ Notification not found');
      return;
    }

    console.log('📋 Notification Details:');
    console.log(`   ID: ${notification._id}`);
    console.log(`   Recipient: ${notification.recipient?.email}`);
    console.log(`   Sender: ${notification.sender?.email}`);
    console.log(`   Media: ${notification.media?._id}`);
    console.log(`   Folder: ${notification.folder?._id} (${notification.folder?.name})`);
    console.log(`   Is Viewed: ${notification.isViewed}`);

    // Check the folder
    const folder = await Folder.findById(notification.folder._id);
    if (!folder) {
      console.log('❌ Folder not found in database');
      return;
    }

    console.log('\n📁 Folder Details:');
    console.log(`   ID: ${folder._id}`);
    console.log(`   Name: ${folder.name}`);
    console.log(`   Owner: ${folder.owner}`);
    console.log(`   Shared With: ${folder.sharedWith.map(s => s.user).join(', ')}`);

    // Check if user has access
    const hasAccess = folder.hasAccess(notification.recipient._id);
    console.log(`\n🔐 Access Check:`);
    console.log(`   User ID: ${notification.recipient._id}`);
    console.log(`   Has Access: ${hasAccess ? '✅ Yes' : '❌ No'}`);

    // Check if user is owner
    const isOwner = folder.owner.toString() === notification.recipient._id.toString();
    console.log(`   Is Owner: ${isOwner ? '✅ Yes' : '❌ No'}`);

    // Check if user is in sharedWith
    const isShared = folder.sharedWith.some(share => 
      share.user.toString() === notification.recipient._id.toString()
    );
    console.log(`   Is Shared With: ${isShared ? '✅ Yes' : '❌ No'}`);

    if (isShared) {
      const shareEntry = folder.sharedWith.find(share => 
        share.user.toString() === notification.recipient._id.toString()
      );
      console.log(`   Permission: ${shareEntry?.permission || 'Unknown'}`);
    }

    // Check the media
    if (notification.media) {
      const media = await Media.findById(notification.media._id);
      if (media) {
        console.log('\n📷 Media Details:');
        console.log(`   ID: ${media._id}`);
        console.log(`   File Name: ${media.fileName}`);
        console.log(`   Owner: ${media.owner}`);
        console.log(`   Folder: ${media.folder}`);
        console.log(`   Is Hidden For: ${media.isHiddenFor.join(', ')}`);
        console.log(`   View Once: ${media.viewOnce?.enabled ? 'Yes' : 'No'}`);
        
        const canView = media.canView(notification.recipient._id);
        console.log(`   Can View: ${canView ? '✅ Yes' : '❌ No'}`);
      } else {
        console.log('\n❌ Media not found in database');
      }
    }

  } catch (error) {
    console.error('❌ Debug failed:', error);
  } finally {
    mongoose.connection.close();
  }
}

debugFolderAccess();










