/**
 * One-time script: sync every partner's activeConversationsCount from actual DB conversations.
 * Run: node scripts/syncPartnerActiveCounts.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Partner from '../models/Partner.js';
import { syncPartnerActiveConversationCount } from '../utils/partnerConversationUtils.js';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const partners = await Partner.find({}).select('_id email name activeConversationsCount').lean();
  let updated = 0;

  for (const partner of partners) {
    const { actualCount } = await syncPartnerActiveConversationCount(partner._id);
    if (partner.activeConversationsCount !== actualCount) {
      console.log(`Synced ${partner.email || partner.name}: ${partner.activeConversationsCount} -> ${actualCount}`);
      updated += 1;
    }
  }

  console.log(`Done. Updated ${updated} of ${partners.length} partners.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
