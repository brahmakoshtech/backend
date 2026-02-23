import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { getobject } from '../utils/s3.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

const restoreMedia = async () => {
  try {
    console.log('🔄 Starting media restoration...\n');
    
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected\n');

    const collections = [
      { name: 'users', fields: ['profileImage', 'profile.profileImage'] },
      { name: 'partners', fields: ['profilePicture'] },
      { name: 'messages', fields: ['mediaUrl'] },
      { name: 'meditations', fields: ['audioUrl', 'thumbnailUrl', 'imageUrl'] },
      { name: 'chantings', fields: ['audioUrl', 'thumbnailUrl', 'imageUrl'] },
      { name: 'prathanas', fields: ['audioUrl', 'thumbnailUrl', 'imageUrl'] },
      { name: 'spiritualclips', fields: ['videoUrl', 'thumbnailUrl'] },
      { name: 'liveavatars', fields: ['videoUrl', 'thumbnailUrl'] },
      { name: 'brahmavatars', fields: ['videoUrl', 'thumbnailUrl'] },
      { name: 'testimonials', fields: ['videoUrl', 'thumbnailUrl', 'imageUrl'] },
      { name: 'sponsors', fields: ['logoUrl', 'imageUrl'] },
      { name: 'brandassets', fields: ['logoUrl', 'imageUrl', 'fileUrl'] },
      { name: 'experts', fields: ['imageUrl', 'profilePicture'] },
      { name: 'expertcategories', fields: ['iconUrl', 'imageUrl'] }
    ];

    let totalRestored = 0;

    for (const { name, fields } of collections) {
      try {
        const collection = mongoose.connection.collection(name);
        const count = await collection.countDocuments();
        
        if (count === 0) {
          console.log(`⏭️  Skipping ${name} (empty)\n`);
          continue;
        }

        console.log(`📦 Processing ${name} (${count} documents)...`);
        
        const docs = await collection.find({}).toArray();
        let restored = 0;

        for (const doc of docs) {
          let updated = false;
          const updateFields = {};

          for (const field of fields) {
            const fieldParts = field.split('.');
            let value = doc;
            
            for (const part of fieldParts) {
              value = value?.[part];
            }

            if (value && typeof value === 'string' && !value.startsWith('http')) {
              try {
                const presignedUrl = await getobject(value);
                if (fieldParts.length === 1) {
                  updateFields[field] = presignedUrl;
                } else {
                  updateFields[field] = presignedUrl;
                }
                updated = true;
              } catch (err) {
                console.log(`   ⚠️  Failed to restore ${field} for ${doc._id}`);
              }
            }
          }

          if (updated) {
            await collection.updateOne({ _id: doc._id }, { $set: updateFields });
            restored++;
          }
        }

        console.log(`   ✅ Restored ${restored} documents\n`);
        totalRestored += restored;
      } catch (err) {
        console.log(`   ❌ Error processing ${name}: ${err.message}\n`);
      }
    }

    console.log(`\n🎉 Migration complete! Total restored: ${totalRestored} documents`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

restoreMedia();
