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

// Helper function to make API calls with retries
async function fetchWithRetry<T>(url: string, params?: any): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get<T>(url, { params });
      return response.data;
    } catch (error) {
      lastError = error as Error;
      console.error(`Attempt ${attempt} failed:`, error);
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY * attempt);
      }
    }
  }
  
  throw lastError;
}

// Transform location data into beatdown objects
function transformLocationToBeatdowns(location: Location): Beatdown[] {
  return location.events.map(event => ({
    dayOfWeek: event.dayOfWeek,
    timeString: event.startTime,
    type: event.eventTypes[0]?.name || 'Unknown',
    region: location.regionName,
    website: location.parentWebsite,
    notes: event.description,
    name: location.name,
    address: location.fullAddress,
    lat: location.lat,
    long: location.lon
  }));
}

async function main() {
  try {
    console.log('Starting beatdown import...');

    // Fetch all locations
    console.log('Fetching map events data...');
    const mapEventsResponse = await fetchWithRetry<MapEventsResponse>(MAP_EVENTS_URL);
    const locations = mapEventsResponse.result.data.json;

    console.log(`Found ${locations.length} locations`);

    // Process locations in batches
    const batches = chunk(locations, 10); // Process 10 locations at a time
    let totalBeatdowns = 0;

    for (const [batchIndex, batch] of batches.entries()) {
      console.log(`Processing batch ${batchIndex + 1}/${batches.length}`);

      // Process each location in the batch
      const locationPromises = batch.map(async ([locationId]) => {
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
      const beatdowns = batchResults.reduce((acc, curr) => acc.concat(curr), []);

      // Write to Firestore in batches
      const beatdownBatches = chunk(beatdowns, BATCH_SIZE);
      
      for (const beatdownBatch of beatdownBatches) {
        const batch = db.batch();
        
        beatdownBatch.forEach(beatdown => {
          const docRef = db.collection('beatdowns').doc();
          batch.set(docRef, beatdown);
        });

        await batch.commit();
        totalBeatdowns += beatdownBatch.length;
      }

      // Add a small delay between batches to avoid rate limiting
      await delay(1000);
    }

    console.log(`Import completed successfully. Imported ${totalBeatdowns} beatdowns.`);

  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  }
}

// Run the import
main().catch(console.error); 