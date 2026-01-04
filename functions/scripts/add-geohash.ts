/**
 * Migration script to add geohash fields to existing beatdown documents
 * 
 * This script reads all existing beatdowns from Firestore, calculates
 * geohash values for each, and updates the documents with the new fields.
 */

import * as admin from 'firebase-admin';
// @ts-ignore - ngeohash doesn't have type definitions
import * as ngeohash from 'ngeohash';
import * as fs from 'fs';
import * as path from 'path';

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, 'service-account.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('Error: service-account.json not found in scripts directory');
  console.error('Please add your Firebase service account key file.');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

interface Beatdown {
  lat: number;
  long: number;
  geohash?: string;
  geohash_4?: string;
  geohash_5?: string;
  geohash_6?: string;
}

const BATCH_SIZE = 500; // Firestore batch write limit

/**
 * Helper function to chunk array into batches
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  console.log('Starting geohash migration...');
  const startTime = Date.now();

  try {
    // Get all beatdowns
    console.log('Fetching all beatdowns from Firestore...');
    const snapshot = await db.collection('beatdowns').get();
    console.log(`Found ${snapshot.docs.length} beatdowns to process`);

    if (snapshot.docs.length === 0) {
      console.log('No beatdowns found. Exiting.');
      return;
    }

    // Process beatdowns and calculate geohashes
    const updates: { docId: string; geohash: string; geohash_4: string; geohash_5: string; geohash_6: string }[] = [];
    let skipped = 0;

    snapshot.docs.forEach(doc => {
      const data = doc.data() as Beatdown;
      
      // Skip if already has geohash
      if (data.geohash) {
        skipped++;
        return;
      }

      // Skip if missing lat/long
      if (typeof data.lat !== 'number' || typeof data.long !== 'number') {
        console.warn(`Skipping doc ${doc.id}: missing or invalid lat/long`);
        skipped++;
        return;
      }

      // Calculate geohash
      const geohash = ngeohash.encode(data.lat, data.long, 12);
      const geohash_4 = geohash.substring(0, 4);
      const geohash_5 = geohash.substring(0, 5);
      const geohash_6 = geohash.substring(0, 6);

      updates.push({
        docId: doc.id,
        geohash,
        geohash_4,
        geohash_5,
        geohash_6
      });
    });

    console.log(`Processing ${updates.length} beatdowns (${skipped} already had geohash or were skipped)`);

    // Batch update documents
    const batches = chunkArray(updates, BATCH_SIZE);
    let processed = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Processing batch ${i + 1}/${batches.length} (${batch.length} documents)`);

      const writeBatch = db.batch();
      for (const update of batch) {
        const docRef = db.collection('beatdowns').doc(update.docId);
        writeBatch.update(docRef, {
          geohash: update.geohash,
          geohash_4: update.geohash_4,
          geohash_5: update.geohash_5,
          geohash_6: update.geohash_6
        });
      }

      await writeBatch.commit();
      processed += batch.length;
      console.log(`Committed batch ${i + 1}/${batches.length}. Processed ${processed}/${updates.length} documents`);
    }

    const duration = Date.now() - startTime;
    console.log(`\nMigration completed successfully!`);
    console.log(`- Total documents: ${snapshot.docs.length}`);
    console.log(`- Updated: ${processed}`);
    console.log(`- Skipped: ${skipped}`);
    console.log(`- Duration: ${(duration / 1000).toFixed(2)}s`);

  } catch (error) {
    console.error('Error during migration:', error);
    process.exit(1);
  }
}

// Run the migration
main()
  .then(() => {
    console.log('Migration script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
