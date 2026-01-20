import mongoose from 'mongoose';
import LiveAvatar from '../models/LiveAvatar.js';

// Update existing LiveAvatars to add missing category field
const updateLiveAvatars = async () => {
  try {
    console.log('🔄 Updating LiveAvatars with missing category field...');
    
    // Find avatars without category field
    const avatarsWithoutCategory = await LiveAvatar.find({
      $or: [
        { category: { $exists: false } },
        { category: null },
        { category: '' }
      ]
    });
    
    console.log(`📊 Found ${avatarsWithoutCategory.length} avatars without category`);
    
    if (avatarsWithoutCategory.length > 0) {
      // Update all avatars without category to default 'Deity'
      const result = await LiveAvatar.updateMany(
        {
          $or: [
            { category: { $exists: false } },
            { category: null },
            { category: '' }
          ]
        },
        {
          $set: { category: 'Deity' }
        }
      );
      
      console.log(`✅ Updated ${result.modifiedCount} avatars with default category 'Deity'`);
    }
    
    // Also fix any gender issues (like Durga Mata)
    const femaleDeities = ['Durga Mata', 'Maa Durga', 'Goddess Durga', 'Lakshmi', 'Saraswati'];
    
    for (const name of femaleDeities) {
      const result = await LiveAvatar.updateMany(
        { 
          name: { $regex: new RegExp(name, 'i') },
          gender: 'Male'
        },
        {
          $set: { gender: 'Female' }
        }
      );
      
      if (result.modifiedCount > 0) {
        console.log(`✅ Fixed gender for ${result.modifiedCount} ${name} avatars`);
      }
    }
    
    console.log('🎉 LiveAvatar update completed successfully!');
    
  } catch (error) {
    console.error('❌ Error updating LiveAvatars:', error);
  }
};

export default updateLiveAvatars;