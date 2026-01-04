/**
 * Migration script to populate cities collection from existing beatdowns
 * 
 * This script reads all existing beatdowns from Firestore, extracts unique
 * cities, aggregates region data, and creates city documents.
 */

import * as admin from 'firebase-admin';
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
  address: string;
  lat: number;
  long: number;
  region: string;
}

interface City {
  city: string;
  normalizedKey: string;
  lat: number;
  long: number;
  regions: string[];
  beatdownCount: number;
  updatedAt: admin.firestore.FieldValue | Date;
}

const BATCH_SIZE = 500; // Firestore batch write limit

/**
 * Extract city and state/country from address, e.g. 'Boise, ID'
 * Matches frontend extractCity() logic
 */
function extractCityFromAddress(address: string | null | undefined): string {
  if (!address) return 'Unknown Location';
  
  // Split by comma and clean up the parts
  const parts = address
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0); // Remove empty parts
  
  if (parts.length >= 3) {
    // e.g. '123 Main St, Boise, ID, USA' or 'Boise, ID, USA'
    // Take the last two parts for city,state
    return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`;
  } else if (parts.length === 2) {
    // e.g. 'Boise, ID'
    return `${parts[0]}, ${parts[1]}`;
  } else if (parts.length === 1) {
    return parts[0];
  }
  return address;
}

/**
 * Normalize a string for deduplication (lowercase, trim, remove extra spaces)
 * Matches frontend normalizeKey() logic
 */
function normalizeCityKey(str: string | null | undefined): string {
  return (str || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Sanitize a string to be used as a Firestore document ID
 * Firestore document IDs cannot contain: /, \, ?, #, [, ], and cannot be longer than 1500 bytes
 */
function sanitizeDocumentId(key: string): string {
  // Replace invalid characters with underscores
  return key
    .replace(/\//g, '_')
    .replace(/\\/g, '_')
    .replace(/\?/g, '_')
    .replace(/#/g, '_')
    .replace(/\[/g, '_')
    .replace(/\]/g, '_')
    // Ensure it's not empty and not too long
    .substring(0, 1500) || 'unknown';
}

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
  console.log('Starting cities migration...');
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

    // Aggregate cities from beatdowns
    const cityMap = new Map<string, {
      city: string;
      normalizedKey: string;
      lat: number;
      long: number;
      regions: Set<string>;
      beatdownCount: number;
    }>();

    console.log('Processing beatdowns and aggregating city data...');
    snapshot.docs.forEach((doc, index) => {
      if ((index + 1) % 1000 === 0) {
        console.log(`  Processed ${index + 1}/${snapshot.docs.length} beatdowns...`);
      }

      const beatdown = doc.data() as Beatdown;
      const city = extractCityFromAddress(beatdown.address);
      const normalizedKey = normalizeCityKey(city);

      if (!normalizedKey || normalizedKey === 'unknown location') {
        return; // Skip invalid cities
      }

      if (!cityMap.has(normalizedKey)) {
        cityMap.set(normalizedKey, {
          city,
          normalizedKey,
          lat: beatdown.lat,
          long: beatdown.long,
          regions: new Set<string>(),
          beatdownCount: 0
        });
      }

      const cityData = cityMap.get(normalizedKey)!;
      cityData.beatdownCount++;
      if (beatdown.region) {
        cityData.regions.add(beatdown.region);
      }
    });

    console.log(`Found ${cityMap.size} unique cities`);

    // Convert to City documents
    const cities: { docId: string; city: City }[] = Array.from(cityMap.entries()).map(([key, data]) => ({
      docId: sanitizeDocumentId(key),
      city: {
        city: data.city,
        normalizedKey: data.normalizedKey,
        lat: data.lat,
        long: data.long,
        regions: Array.from(data.regions),
        beatdownCount: data.beatdownCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    }));

    // Batch write cities
    const batches = chunkArray(cities, BATCH_SIZE);
    let processed = 0;

    console.log(`Writing ${cities.length} cities in ${batches.length} batches...`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Processing batch ${i + 1}/${batches.length} (${batch.length} cities)`);

      const writeBatch = db.batch();
      for (const { docId, city } of batch) {
        const docRef = db.collection('cities').doc(docId);
        writeBatch.set(docRef, city);
      }

      await writeBatch.commit();
      processed += batch.length;
      console.log(`Committed batch ${i + 1}/${batches.length}. Processed ${processed}/${cities.length} cities`);
    }

    const duration = Date.now() - startTime;
    console.log(`\nMigration completed successfully!`);
    console.log(`- Total beatdowns processed: ${snapshot.docs.length}`);
    console.log(`- Unique cities created: ${cities.length}`);
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
