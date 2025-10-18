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

async function checkNotifications() {
  try {
    console.log('🔍 Checking All Notifications...\n');

    // Get all users
    const users = await User.find();
    console.log('Users:', users.map(u => u.email));

    // Check notifications for each user
    for (const user of users) {
      console.log(`\n👤 Checking notifications for: ${user.email}`);
      
      const notifications = await Notification.find({
        recipient: user._id,
        type: { $in: ['media_shared', 'media_view_once'] },
        isViewed: false
      })
      .populate('sender', 'email')
      .populate('media', 'fileName')
      .populate('folder', 'name')
      .sort({ createdAt: -1 });

      console.log(`   Found ${notifications.length} unviewed notifications`);
      
      notifications.forEach((notification, index) => {
        console.log(`   ${index + 1}. ${notification.title} from ${notification.sender?.email}`);
        console.log(`      Media: ${notification.media?.fileName || 'No media'}`);
        console.log(`      Folder: ${notification.folder?.name || 'No folder'}`);
        console.log(`      View Once: ${notification.viewOnce}`);
      });
    }

  } catch (error) {
    console.error('❌ Check failed:', error);
  } finally {
    mongoose.connection.close();
  }
}

checkNotifications();
