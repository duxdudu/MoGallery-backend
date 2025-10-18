const mongoose = require('mongoose');
const Media = require('./models/Media');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mogallery', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function fixViewOnceField() {
  try {
    console.log('🔧 Fixing viewOnce field structure...');
    
    // Find all media documents where viewOnce is not an object
    const mediaWithInvalidViewOnce = await Media.find({
      $or: [
        { viewOnce: { $type: 'bool' } }, // viewOnce is boolean
        { viewOnce: null }, // viewOnce is null
        { viewOnce: { $exists: false } } // viewOnce doesn't exist
      ]
    });

    console.log(`Found ${mediaWithInvalidViewOnce.length} media documents with invalid viewOnce structure`);

    // Fix each document
    for (const media of mediaWithInvalidViewOnce) {
      console.log(`Fixing media: ${media.fileName} (${media._id})`);
      
      // Set proper viewOnce structure
      media.viewOnce = {
        enabled: false,
        sharedWith: []
      };
      
      await media.save();
    }

    console.log('✅ Successfully fixed all media documents');
    
    // Verify the fix
    const remainingInvalid = await Media.find({
      $or: [
        { viewOnce: { $type: 'bool' } },
        { viewOnce: null },
        { viewOnce: { $exists: false } }
      ]
    });

    if (remainingInvalid.length === 0) {
      console.log('✅ All media documents now have proper viewOnce structure');
    } else {
      console.log(`⚠️  ${remainingInvalid.length} documents still have invalid structure`);
    }

  } catch (error) {
    console.error('❌ Error fixing viewOnce field:', error);
  } finally {
    mongoose.connection.close();
  }
}

fixViewOnceField();










