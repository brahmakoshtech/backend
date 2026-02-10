import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const rollbackMigration = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('spiritualconfigurations');

    // Find all documents that were migrated (have chantingType but no customChantingType)
    const docs = await collection.find({ 
      chantingType: { $exists: true, $ne: '' }
    }).toArray();

    console.log(`📊 Found ${docs.length} documents to rollback`);

    let rolledBackCount = 0;
    for (const doc of docs) {
      // Restore customChantingType from chantingType
      await collection.updateOne(
        { _id: doc._id },
        { 
          $set: { 
            chantingType: 'Other',
            customChantingType: doc.chantingType 
          }
        }
      );
      console.log(`✅ Rolled back: ${doc.title} - restored customChantingType="${doc.chantingType}"`);
      rolledBackCount++;
    }

    console.log(`\n🎉 Rollback completed!`);
    console.log(`📊 Total documents rolled back: ${rolledBackCount}`);

    await mongoose.connection.close();
    console.log('✅ Database connection closed');
  } catch (error) {
    console.error('❌ Rollback failed:', error);
    process.exit(1);
  }
};

rollbackMigration();
