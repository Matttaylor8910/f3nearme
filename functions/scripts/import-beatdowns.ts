import * as admin from 'firebase-admin';
import axios from 'axios';
import { chunk } from 'lodash';
import * as path from 'path';

// Initialize Firebase Admin with service account
const serviceAccount = require('./service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Types
interface EventType {
  id: number;
  name: string;
}

interface Event {
  id: number;
  name: string;
  description: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  eventTypes: EventType[];
  aoId: number;
  aoLogo: string;
  aoWebsite: string;
  aoName: string;
}

interface LocationMeta {
  latLonKey: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  mapSeed: boolean;
}

interface Location {
  id: number;
  name: string;
  description: string | null;
  lat: number;
  lon: number;
  orgId: number;
  locationName: string;
  locationMeta: LocationMeta;
  locationAddress: string;
  locationAddress2: string;
  locationCity: string;
  locationState: string;
  locationZip: string;
  locationCountry: string;
  isActive: boolean;
  created: string;
  updated: string;
  locationDescription: string | null;
  parentId: number;
  parentLogo: string;
  parentName: string;
  parentWebsite: string;
  regionId: number;
  regionName: string;
  regionLogo: string | null;
  regionWebsite: string;
  regionType: string;
  fullAddress: string;
  events: Event[];
}

interface Beatdown {
  dayOfWeek: string;
  timeString: string;
  type: string;
  region: string;
  website: string;
  notes: string;
  name: string;
  address: string;
  lat: number;
  long: number;
  locationId: number;
}

// API Response Types
interface MapEventsResponse {
  result: {
    data: {
      json: Array<[number, string, string | null, number, number, string, Array<[number, string, string, string, Array<{id: number, name: string}>]>]>;
    };
  };
}

interface LocationDataResponse {
  result: {
    data: {
      json: {
        location: Location;
      };
    };
  };
}

// Constants
const MAP_EVENTS_URL = 'https://map.f3nation.com/api/trpc/location.getMapEventAndLocationData';
const LOCATION_DATA_URL = 'https://map.f3nation.com/api/trpc/location.getLocationWorkoutData';
const BATCH_SIZE = 500; // Firestore batch write limit
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// Helper function to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to format error messages
function formatErrorMessage(error: any): string {
  if (error.response) {
    // The request was made and the server responded with a status code
    // that falls out of the range of 2xx
    return `HTTP Error ${error.response.status}: ${error.response.statusText}`;
  } else if (error.request) {
    // The request was made but no response was received
    return 'No response received from server';
  } else {
    // Something happened in setting up the request that triggered an Error
    return error.message || 'Unknown error occurred';
  }
}

// Helper function to make API calls with retries
async function fetchWithRetry<T>(url: string, params?: any): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get<T>(url, { params });
      return response.data;
    } catch (error) {
      lastError = error as Error;
      const errorMessage = formatErrorMessage(error);
      console.error(`Attempt ${attempt}/${MAX_RETRIES} failed: ${errorMessage}`);
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY * attempt);
      }
    }
  }
  
  throw new Error(`All ${MAX_RETRIES} attempts failed. Last error: ${formatErrorMessage(lastError)}`);
}

// Helper function to format military time to AM/PM
function formatTime(militaryTime: string | null | undefined): string {
  if (!militaryTime) {
    return '';
  }
  // Ensure we have a 4-digit string
  const paddedTime = militaryTime.padStart(4, '0');
  const hours = parseInt(paddedTime.substring(0, 2));
  const minutes = paddedTime.substring(2);
  const period = hours >= 12 ? 'pm' : 'am';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes} ${period}`;
}

// Transform location data into beatdown objects
function transformLocationToBeatdowns(location: Location): Beatdown[] {
  return location.events.map(event => ({
    dayOfWeek: event.dayOfWeek,
    timeString: `${formatTime(event.startTime)} - ${formatTime(event.endTime)}`,
    type: event.eventTypes[0]?.name || 'Unknown',
    region: location.regionName,
    website: location.parentWebsite,
    notes: event.description,
    name: location.name,
    address: location.fullAddress,
    lat: location.lat,
    long: location.lon,
    locationId: location.id
  }));
}

// Helper function to generate a consistent document ID
function generateBeatdownId(beatdown: Beatdown): string {
  // Create a unique ID based on name, day, and time
  const baseString = `${beatdown.name}-${beatdown.dayOfWeek}-${beatdown.timeString}`;
  // Convert to lowercase and replace spaces/special chars with hyphens
  return baseString.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

async function main() {
  try {
    console.log('Starting beatdown import...');

    // First, fetch all existing beatdowns to track what needs to be migrated
    console.log('Fetching existing beatdowns...');
    const existingBeatdownsSnapshot = await db.collection('beatdowns').get();
    const existingBeatdowns = new Map();
    existingBeatdownsSnapshot.forEach((doc: admin.firestore.QueryDocumentSnapshot) => {
      existingBeatdowns.set(doc.id, doc.data());
    });
    console.log(`Found ${existingBeatdowns.size} existing beatdowns`);

    // Fetch all locations
    console.log('Fetching map events data...');
    const mapEventsResponse = await fetchWithRetry<MapEventsResponse>(MAP_EVENTS_URL);
    const locations = mapEventsResponse.result.data.json;

    console.log(`Found ${locations.length} locations`);

    // Process locations in batches
    const batches = chunk(locations, 10); // Process 10 locations at a time
    let totalBeatdowns = 0;
    let updatedBeatdowns = 0;
    let newBeatdowns = 0;
    let deletedBeatdowns = 0;
    const processedIds = new Set<string>();

    for (const [batchIndex, batch] of batches.entries()) {
      console.log(`Processing batch ${batchIndex + 1}/${batches.length}`);

      // Process each location in the batch
      const locationPromises = batch.map(async ([locationId, , , , , , ]: [number, string, string | null, number, number, string, Array<[number, string, string, string, Array<{id: number, name: string}>]>]) => {
        try {
          const url = `${LOCATION_DATA_URL}?input={"json":{"locationId":${locationId}}}`;
          const locationData = await fetchWithRetry<LocationDataResponse>(url);

          const location = locationData.result.data.json.location;
          return transformLocationToBeatdowns(location);
        } catch (error) {
          console.error(`Error processing location ${locationId}:`, error);
          return [];
        }
      });

      const batchResults = await Promise.all(locationPromises);
      const beatdowns = batchResults.reduce((acc: Beatdown[], curr: Beatdown[]) => acc.concat(curr), []);

      // Write to Firestore in batches
      const beatdownBatches = chunk(beatdowns, BATCH_SIZE);
      
      for (const beatdownBatch of beatdownBatches) {
        const batch = db.batch();
        const deleteBatch = db.batch();
        
        for (const beatdown of beatdownBatch) {
          const docId = generateBeatdownId(beatdown);
          const docRef = db.collection('beatdowns').doc(docId);
          processedIds.add(docId);
          
          // Check if document exists
          const doc = await docRef.get();
          if (doc.exists) {
            updatedBeatdowns++;
          } else {
            newBeatdowns++;
          }
          
          batch.set(docRef, beatdown);
        }

        await batch.commit();
        totalBeatdowns += beatdownBatch.length;
      }

      // Add a small delay between batches to avoid rate limiting
      await delay(1000);
    }

    // After all new records are created, delete the old ones
    console.log('Cleaning up old records...');
    const deleteBatches = chunk([...existingBeatdowns.keys()], BATCH_SIZE);
    
    for (const oldIds of deleteBatches) {
      const batch = db.batch();
      for (const oldId of oldIds) {
        const docRef = db.collection('beatdowns').doc(oldId);
        batch.delete(docRef);
        deletedBeatdowns++;
      }
      await batch.commit();
      await delay(1000); // Small delay between delete batches
    }

    console.log(`Migration completed successfully.`);
    console.log(`Total beatdowns processed: ${totalBeatdowns}`);
    console.log(`New beatdowns created: ${newBeatdowns}`);
    console.log(`Existing beatdowns updated: ${updatedBeatdowns}`);
    console.log(`Old records deleted: ${deletedBeatdowns}`);

  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  }
}

// Run the import
main().catch(console.error); 