import * as admin from 'firebase-admin';
import axios, { AxiosError } from 'axios';
import { chunk } from 'lodash';
import * as path from 'path';

// Initialize Firebase Admin with service account
const serviceAccount = require('./service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const OPTIONAL_CLEANUP = false;

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
  eventId: number;
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

// Helper function to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to format error messages
function formatErrorMessage(error: any): string {
  if (error.response) {
    // The request was made and the server responded with a status code
    // that falls out of the range of 2xx
    return `HTTP ${error.response.status}`;
  } else if (error.request) {
    // The request was made but no response was received
    return 'No response';
  } else {
    // Something happened in setting up the request that triggered an Error
    return 'Request failed';
  }
}

// Helper function to make API calls
async function fetchWithRetry<T>(url: string, params?: any): Promise<T> {
  try {
    const response = await axios.get<T>(url, { params });
    return response.data;
  } catch (error) {
    throw error;
  }
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
    notes: event.description || location.description || '',
    name: event.name || location.name || location.parentName || '',
    address: location.fullAddress,
    lat: location.lat,
    long: location.lon,
    locationId: location.id,
    eventId: event.id
  }));
}

// Helper function to generate a consistent document ID
function generateBeatdownId(beatdown: Beatdown): string {
  // Create ID using region name, beatdown name, and day
  const baseString = `${beatdown.region}_${beatdown.name}_${beatdown.dayOfWeek}`;
  // Convert to lowercase and replace spaces/special chars with hyphens
  return baseString.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

// Add new interface for location analysis
interface LocationAnalysis {
  added: number[];
  deleted: number[];
  newBeatdowns: number;
  updatedBeatdowns: number;
}

// Add new function to analyze location changes
async function analyzeLocationChanges(): Promise<LocationAnalysis> {
  console.log('Analyzing location changes...');

  // Get all existing beatdowns and extract unique locationIds
  const existingBeatdownsSnapshot = await db.collection('beatdowns').get();
  const existingLocationIds = new Set<number>();
  
  existingBeatdownsSnapshot.forEach((doc: admin.firestore.QueryDocumentSnapshot) => {
    const data = doc.data() as Beatdown;
    existingLocationIds.add(data.locationId);
  });
  
  console.log(`Found ${existingLocationIds.size} unique locations in database`);

  // Fetch all locations from the API
  const mapEventsResponse = await fetchWithRetry<MapEventsResponse>(MAP_EVENTS_URL);
  const apiLocationIds = new Set(mapEventsResponse.result.data.json.map(([locationId]) => locationId));
  
  console.log(`Found ${apiLocationIds.size} locations in API`);

  // Find added and deleted locations
  const added = Array.from(apiLocationIds).filter(id => !existingLocationIds.has(id));
  const deleted = Array.from(existingLocationIds).filter(id => !apiLocationIds.has(id));

  // Process new locations in batches
  let newBeatdowns = 0;
  let updatedBeatdowns = 0;
  const batches = chunk(added, 10); // Process 10 locations at a time

  for (const [batchIndex, batch] of batches.entries()) {
    console.log(`Processing new locations batch ${batchIndex + 1}/${batches.length}`);

    // Process each location in the batch
    const locationPromises = batch.map(locationId => fetchAndProcessLocation(locationId));
    const batchResults = await Promise.all(locationPromises);
    const beatdowns = batchResults.reduce((acc: Beatdown[], curr: Beatdown[]) => acc.concat(curr), []);

    // Write to Firestore in batches
    const beatdownBatches = chunk(beatdowns, BATCH_SIZE);
    
    for (const beatdownBatch of beatdownBatches) {
      const batch = db.batch();
      
      for (const beatdown of beatdownBatch) {
        const docId = generateBeatdownId(beatdown);
        const docRef = db.collection('beatdowns').doc(docId);
        
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
    }

    // Add a small delay between batches to avoid rate limiting
    await delay(1000);
  }

  return {
    added,
    deleted,
    newBeatdowns,
    updatedBeatdowns
  };
}

// Add new function to fetch and process a single location
async function fetchAndProcessLocation(locationId: number): Promise<Beatdown[]> {
  try {
    const url = `${LOCATION_DATA_URL}?input={"json":{"locationId":${locationId}}}`;
    const locationData = await fetchWithRetry<LocationDataResponse>(url);
    const location = locationData.result.data.json.location;
    return transformLocationToBeatdowns(location);
  } catch (error) {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      console.log(`Location ${locationId}: ${status ? `HTTP ${status}` : 'Failed to fetch'}`);
    } else {
      console.log(`Location ${locationId}: Unknown error`);
    }
    return [];
  }
}

async function main() {
  try {
    // Check if we're in analysis mode
    const isAnalysisMode = process.argv.includes('--analyze');
    
    if (isAnalysisMode) {
      const analysis = await analyzeLocationChanges();
      console.log('\nLocation Analysis Results:');
      console.log('------------------------');
      console.log(`Added Locations (${analysis.added.length}):`);
      analysis.added.forEach(id => console.log(`- Location ID: ${id}`));
      console.log(`\nDeleted Locations (${analysis.deleted.length}):`);
      analysis.deleted.forEach(id => console.log(`- Location ID: ${id}`));
      console.log(`\nSync Results:`);
      console.log(`- New beatdowns created: ${analysis.newBeatdowns}`);
      console.log(`- Existing beatdowns updated: ${analysis.updatedBeatdowns}`);
      return;
    }

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
    const processedIds = new Set<string>();

    for (const [batchIndex, batch] of batches.entries()) {
      console.log(`Processing batch ${batchIndex + 1}/${batches.length}`);

      // Process each location in the batch
      const locationPromises = batch.map(([locationId]) => fetchAndProcessLocation(locationId));
      const batchResults = await Promise.all(locationPromises);
      const beatdowns = batchResults.reduce((acc: Beatdown[], curr: Beatdown[]) => acc.concat(curr), []);

      // Write to Firestore in batches
      const beatdownBatches = chunk(beatdowns, BATCH_SIZE);
      
      for (const beatdownBatch of beatdownBatches) {
        const batch = db.batch();
        
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

    console.log(`Migration completed successfully.`);
    console.log(`Total beatdowns processed: ${totalBeatdowns}`);
    console.log(`New beatdowns created: ${newBeatdowns}`);
    console.log(`Existing beatdowns updated: ${updatedBeatdowns}`);

    // Delete any documents that weren't part of this import
    if (OPTIONAL_CLEANUP) {
      console.log('Cleaning up old documents...');
      const docsToDelete = Array.from(existingBeatdowns.keys()).filter(id => !processedIds.has(id));
      
      if (docsToDelete.length > 0) {
        console.log(`Found ${docsToDelete.length} documents to delete`);
        // Delete in batches to stay within Firestore limits
        const deleteBatches = chunk(docsToDelete, BATCH_SIZE);
        
        for (const deleteBatch of deleteBatches) {
          const batch = db.batch();
          deleteBatch.forEach(docId => {
            batch.delete(db.collection('beatdowns').doc(docId));
          });
          await batch.commit();
        }
        console.log(`Successfully deleted ${docsToDelete.length} old documents`);
      } else {
        console.log('No old documents to delete');
      }
    }

  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  }
}

// Run the import
main().catch(console.error); 