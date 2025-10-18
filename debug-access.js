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

async function debugAccess() {
  try {
    console.log('🔍 Debugging Access Issues...\n');

    // Get all notifications
    const notifications = await Notification.find()
      .populate('recipient', 'email')
      .populate('sender', 'email')
      .populate('media', 'fileName originalName folder')
      .populate('folder', 'name owner sharedWith')
      .sort({ createdAt: -1 })
      .limit(5);

    console.log(`Found ${notifications.length} notifications:\n`);

    for (const notification of notifications) {
      console.log(`📋 Notification: ${notification._id}`);
      console.log(`   Type: ${notification.type}`);
      console.log(`   Recipient: ${notification.recipient?.email || 'Unknown'}`);
      console.log(`   Sender: ${notification.sender?.email || 'Unknown'}`);
      console.log(`   Media: ${notification.media?.originalName || 'No media'}`);
      console.log(`   Folder: ${notification.folder?.name || 'No folder'}`);
      
      if (notification.media && notification.folder && notification.recipient) {
        console.log(`\n   🔍 Checking access for ${notification.recipient.email}:`);
        
        // Check folder access
        const folder = await Folder.findById(notification.folder._id);
        if (folder) {
          const hasFolderAccess = folder.hasAccess(notification.recipient._id);
          console.log(`   📁 Folder access: ${hasFolderAccess ? '✅ Yes' : '❌ No'}`);
          console.log(`   📁 Folder owner: ${folder.owner}`);
          console.log(`   📁 Folder sharedWith: ${folder.sharedWith.map(s => s.user).join(', ')}`);
        } else {
          console.log(`   📁 Folder: ❌ Not found`);
        }
        
        // Check media access
        const media = await Media.findById(notification.media._id);
        if (media) {
          const canViewMedia = media.canView(notification.recipient._id);
          console.log(`   📷 Media access: ${canViewMedia ? '✅ Yes' : '❌ No'}`);
          console.log(`   📷 Media owner: ${media.owner}`);
          console.log(`   📷 Media isHiddenFor: ${media.isHiddenFor.join(', ')}`);
          console.log(`   📷 Media viewOnce: ${media.viewOnce?.enabled ? 'Yes' : 'No'}`);
        } else {
          console.log(`   📷 Media: ❌ Not found`);
        }
      }
      
      console.log('\n' + '='.repeat(50) + '\n');
    }

  } catch (error) {
    console.error('❌ Debug failed:', error);
  } finally {
    mongoose.connection.close();
  }
}

debugAccess();
