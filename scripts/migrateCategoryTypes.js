import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

const migrateCategoryTypes = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('spiritualconfigurations');

    // Find all documents with chantingType field
    const docs = await collection.find({ chantingType: { $exists: true, $ne: '' } }).toArray();
    console.log(`Found ${docs.length} documents with chantingType field`);

    let migratedCount = 0;

    for (const doc of docs) {
      const updateData = {};
      
      // Move chantingType to correct field based on type
      if (doc.type === 'meditation' && doc.chantingType) {
        updateData.meditationType = doc.chantingType;
        updateData.chantingType = '';
        console.log(`Migrating meditation: ${doc.title} - ${doc.chantingType} -> meditationType`);
      } else if (doc.type === 'prayer' && doc.chantingType) {
        updateData.prayerType = doc.chantingType;
        updateData.chantingType = '';
        console.log(`Migrating prayer: ${doc.title} - ${doc.chantingType} -> prayerType`);
      } else if (doc.type === 'chanting' && doc.chantingType) {
        console.log(`Keeping chanting: ${doc.title} - ${doc.chantingType} in chantingType`);
        continue; // Already correct
      }

      if (Object.keys(updateData).length > 0) {
        await collection.updateOne(
          { _id: doc._id },
          { $set: updateData }
        );
        migratedCount++;
      }
    }

    console.log(`\nMigration completed successfully!`);
    console.log(`Total documents migrated: ${migratedCount}`);

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
};

migrateCategoryTypes();
