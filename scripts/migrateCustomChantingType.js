import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const migrateCustomChantingType = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('spiritualconfigurations');

    // Find all documents with customChantingType field
    const docsWithCustomType = await collection.find({ 
      customChantingType: { $exists: true, $ne: '' } 
    }).toArray();

    console.log(`📊 Found ${docsWithCustomType.length} documents with customChantingType field`);

    if (docsWithCustomType.length === 0) {
      console.log('✅ No migration needed - all data is clean!');
      await mongoose.connection.close();
      return;
    }

    // Migrate each document
    let migratedCount = 0;
    for (const doc of docsWithCustomType) {
      // If customChantingType has value, copy it to chantingType
      if (doc.customChantingType && doc.customChantingType.trim() !== '') {
        await collection.updateOne(
          { _id: doc._id },
          { 
            $set: { chantingType: doc.customChantingType },
            $unset: { customChantingType: '' }
          }
        );
        console.log(`✅ Migrated: ${doc.title} - chantingType set to "${doc.customChantingType}"`);
        migratedCount++;
      } else {
        // Just remove empty customChantingType field
        await collection.updateOne(
          { _id: doc._id },
          { $unset: { customChantingType: '' } }
        );
      }
    }

    console.log(`\n🎉 Migration completed successfully!`);
    console.log(`📊 Total documents migrated: ${migratedCount}`);
    console.log(`🗑️  Removed customChantingType field from all documents`);

    await mongoose.connection.close();
    console.log('✅ Database connection closed');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

migrateCustomChantingType();
