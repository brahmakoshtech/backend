import mongoose from 'mongoose';
import SpiritualConfiguration from '../models/SpiritualConfiguration.js';

// Migration script to add categoryId to existing configurations
const migrateCategoryIds = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/brahmkosh');
    
    console.log('Starting migration: Adding categoryId to existing configurations...');
    
    // Sample category IDs (replace with actual activity IDs from your database)
    const categoryMapping = {
      'meditation': '69787dfbbeaf7e42675a221d', // Replace with actual meditation activity ID
      'prayer': '69787dfbbeaf7e42675a221e',     // Replace with actual prayer activity ID  
      'chanting': '69787dfbbeaf7e42675a221f',   // Replace with actual chanting activity ID
      'silence': '69787dfbbeaf7e42675a2220'     // Replace with actual silence activity ID
    };
    
    // Update configurations based on their type
    for (const [type, categoryId] of Object.entries(categoryMapping)) {
      const result = await SpiritualConfiguration.updateMany(
        { 
          type: type,
          $or: [
            { categoryId: { $exists: false } },
            { categoryId: '' },
            { categoryId: null }
          ]
        },
        { 
          $set: { categoryId: categoryId }
        }
      );
      
      console.log(`Updated ${result.modifiedCount} ${type} configurations with categoryId: ${categoryId}`);
    }
    
    console.log('Migration completed successfully!');
    
    // Verify the migration
    const updatedConfigs = await SpiritualConfiguration.find({ categoryId: { $ne: '' } });
    console.log(`Total configurations with categoryId: ${updatedConfigs.length}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

// Run migration
migrateCategoryIds();