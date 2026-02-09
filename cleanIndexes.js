import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const dropAllDuplicateIndexes = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    
    console.log('📋 Found collections:', collections.map(c => c.name).join(', '));
    console.log('\n🔍 Checking for duplicate indexes...\n');

    // Check each collection
    for (const collection of collections) {
      const collectionName = collection.name;
      
      try {
        const indexes = await db.collection(collectionName).indexes();
        console.log(`\n📁 ${collectionName}:`);
        console.log('   Indexes:', indexes.map(i => i.name).join(', '));
        
        // Drop userId_1 if compound index exists
        const hasUserIdSingle = indexes.some(i => i.name === 'userId_1');
        const hasUserIdCompound = indexes.some(i => i.name.includes('userId_1_') && i.name !== 'userId_1');
        
        if (hasUserIdSingle && hasUserIdCompound) {
          await db.collection(collectionName).dropIndex('userId_1');
          console.log('   ✅ Dropped userId_1 (compound index exists)');
        }
        
        // Drop sankalpId_1 if compound index exists
        const hasSankalpIdSingle = indexes.some(i => i.name === 'sankalpId_1');
        const hasSankalpIdCompound = indexes.some(i => i.name.includes('sankalpId_1') && i.name !== 'sankalpId_1');
        
        if (hasSankalpIdSingle && hasSankalpIdCompound) {
          await db.collection(collectionName).dropIndex('sankalpId_1');
          console.log('   ✅ Dropped sankalpId_1 (compound index exists)');
        }
        
      } catch (error) {
        console.log(`   ⚠️ Error checking ${collectionName}:`, error.message);
      }
    }

    console.log('\n✅ All duplicate indexes checked and dropped!');
    console.log('🔄 Restart your backend server now.\n');
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

dropAllDuplicateIndexes();
