import * as admin from 'firebase-admin';
import axios, { AxiosError } from 'axios';
import { chunk } from 'lodash';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Initialize Firebase Admin with service account
const serviceAccount = require('./service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Enable cleanup by default - can be disabled with --no-cleanup flag
// Cleanup deletes beatdowns that no longer exist in the API
let ENABLE_CLEANUP = true;

// Types - New API Structure
interface ApiEventType {
  eventTypeId: number;
  eventTypeName: string;
}

interface ApiEvent {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  isPrivate: boolean;
  parent: string;
  locationId: number;
  startDate: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  email: string | null;
  created: string;
  locationName: string;
  locationAddress: string | null;
  locationAddress2: string | null;
  locationCity: string;
  locationState: string;
  locationZip: string;
  parents: Array<{
    parentId: number;
    parentName: string;
  }>;
  regions: Array<{
    regionId: number;
    regionName: string;
  }>;
  location: string; // Full address string
  eventTypes?: Array<{
    eventTypeId: number;
    eventTypeName: string;
  }>; // Only present when fetching individual events
}

interface ApiLocation {
  id: number;
  locationName: string;
  description: string | null;
  isActive: boolean;
  created: string;
  orgId: number;
  regionId: number;
  regionName: string;
  email: string | null;
  latitude: number;
  longitude: number;
  addressStreet: string | null;
  addressStreet2: string | null;
  addressCity: string;
  addressState: string;
  addressZip: string;
  addressCountry: string | null;
  meta: any;
}

interface EventsResponse {
  events: ApiEvent[];
}

interface LocationResponse {
  location: ApiLocation;
}

interface LocationsResponse {
  locations: ApiLocation[];
  totalCount: number;
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

// Constants
const API_BASE_URL = 'https://api.f3nation.com';
const EVENTS_URL = `${API_BASE_URL}/v1/event?pageSize=10000`; // Get all events in one request
const LOCATIONS_URL = `${API_BASE_URL}/v1/location`; // Bulk endpoint for all locations
const LOCATION_URL = `${API_BASE_URL}/v1/location/id`; // Individual location endpoint (fallback)
// Get API key from environment variable - REQUIRED, no default
const API_KEY = process.env.F3_API_KEY;
const CLIENT_HEADER = process.env.F3_CLIENT || 'f3nearme';
const BATCH_SIZE = 500; // Firestore batch write limit

if (!API_KEY) {
  console.error('ERROR: F3_API_KEY environment variable is required.');
  console.error('Please set it in your .env file or as an environment variable.');
  process.exit(1);
}

// API request headers
const API_HEADERS = {
  'Authorization': `Bearer ${API_KEY}`,
  'client': CLIENT_HEADER
};

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

// Helper function to parse wait time from rate limit error message
function parseRateLimitWaitTime(message: string): number {
  // Parse messages like "Rate limit exceeded. Try again in 7s" or "Try again in 10s"
  const match = message.match(/try again in (\d+)s/i);
  if (match && match[1]) {
    return parseInt(match[1], 10) * 1000; // Convert to milliseconds
  }
  // Default to 10 seconds if we can't parse it
  return 10000;
}

// Helper function to make API calls with authentication and rate limit handling
async function fetchWithRetry<T>(url: string, params?: any, retryCount: number = 0, maxRetries: number = 3): Promise<T> {
  try {
    const response = await axios.get<T>(url, { 
      params,
      headers: API_HEADERS
    });
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError && error.response?.status === 429) {
      const errorData = error.response.data as any;
      const message = errorData?.message || '';
      const waitTime = message ? parseRateLimitWaitTime(message) : 10000; // Default 10 seconds
      
      if (retryCount < maxRetries) {
        // Extract a short URL identifier for logging (just the endpoint, not full URL)
        const urlParts = url.split('/');
        const endpoint = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2] || 'endpoint';
        console.log(`⏳ Rate limit exceeded (${endpoint}). Waiting ${waitTime / 1000}s before retry ${retryCount + 1}/${maxRetries}...`);
        await delay(waitTime);
        return fetchWithRetry<T>(url, params, retryCount + 1, maxRetries);
      } else {
        console.error(`❌ Rate limit exceeded. Max retries (${maxRetries}) reached for ${url}`);
        throw new Error(`Rate limit exceeded after ${maxRetries} retries`);
      }
    }
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

// Transform API event and location data into beatdown objects
function transformEventToBeatdown(event: ApiEvent, location: ApiLocation): Beatdown {
  // Get region name from event (preferred) or location
  const regionName = event.regions?.[0]?.regionName || location.regionName || 'Unknown Region';
  
  // Get website from parents array (first parent's website if available)
  // Note: API doesn't return website in event, so we'll use empty string for now
  const website = '';
  
  // Build full address from event location string or location fields
  const address = event.location || 
    [event.locationAddress, event.locationAddress2, event.locationCity, event.locationState, event.locationZip]
      .filter(Boolean)
      .join(', ') ||
    [location.addressStreet, location.addressStreet2, location.addressCity, location.addressState, location.addressZip]
      .filter(Boolean)
      .join(', ');
  
  // Get event type name - eventTypes may be populated if event was fetched individually
  const eventType = event.eventTypes?.[0]?.eventTypeName || 'Unknown';
  
  return {
    dayOfWeek: event.dayOfWeek,
    timeString: `${formatTime(event.startTime)} - ${formatTime(event.endTime)}`,
    type: eventType,
    region: regionName,
    website: website,
    notes: event.description || '',
    name: event.name || event.locationName || location.locationName || '',
    address: address,
    lat: location.latitude,
    long: location.longitude,
    locationId: event.locationId,
    eventId: event.id
  };
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

  // Fetch all locations and events in bulk (much more efficient!)
  console.log('Fetching all locations and events in bulk...');
  const [locationsResponse, eventsResponse] = await Promise.all([
    fetchWithRetry<LocationsResponse>(LOCATIONS_URL),
    fetchWithRetry<EventsResponse>(EVENTS_URL)
  ]);
  
  const apiLocationIds = new Set(eventsResponse.events.map(event => event.locationId));
  console.log(`Found ${apiLocationIds.size} unique locations in API events`);
  
  // Build location map
  const locationMap = new Map<number, ApiLocation>();
  for (const location of locationsResponse.locations) {
    locationMap.set(location.id, location);
  }
  
  // Find added and deleted locations
  const added = Array.from(apiLocationIds).filter(id => !existingLocationIds.has(id));
  const deleted = Array.from(existingLocationIds).filter(id => !apiLocationIds.has(id));

  // Process new locations in batches
  let newBeatdowns = 0;
  let updatedBeatdowns = 0;
  const batches = chunk(added, 10); // Process 10 locations at a time

  for (const [batchIndex, batch] of batches.entries()) {
    console.log(`Processing new locations batch ${batchIndex + 1}/${batches.length}`);

    // Process each location in the batch using bulk data
    const locationPromises = batch.map((locationId: number) => 
      fetchAndProcessLocation(locationId, locationMap, eventsResponse.events)
    );
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

// Fetch and process events for a single location
// NOTE: This function is used by analyzeLocationChanges and should use bulk endpoints when possible
async function fetchAndProcessLocation(locationId: number, locationMap?: Map<number, ApiLocation>, allEvents?: ApiEvent[]): Promise<Beatdown[]> {
  try {
    let location: ApiLocation | undefined;
    
    // Use provided location map if available, otherwise fetch individually
    if (locationMap) {
      location = locationMap.get(locationId);
    }
    
    if (!location) {
      // Fallback: fetch location individually
      const locationUrl = `${LOCATION_URL}/${locationId}`;
      const locationResponse = await fetchWithRetry<LocationResponse>(locationUrl);
      location = locationResponse.location;
    }
    
    if (!location) {
      console.warn(`Location ${locationId} not found`);
      return [];
    }
    
    // Use provided events if available, otherwise fetch all events
    let locationEvents: ApiEvent[];
    if (allEvents) {
      locationEvents = allEvents.filter(e => e.locationId === locationId);
    } else {
      const eventsResponse = await fetchWithRetry<EventsResponse>(EVENTS_URL);
      locationEvents = eventsResponse.events.filter(e => e.locationId === locationId);
    }
    
    // Transform events to beatdowns (without fetching individual event types for efficiency)
    return locationEvents.map(event => transformEventToBeatdown(event, location!));
  } catch (error) {
    // Don't log full error for rate limit errors (they're handled in fetchWithRetry)
    if (error instanceof AxiosError && error.response?.status === 429) {
      console.log(`Location ${locationId}: Rate limit exceeded (max retries reached)`);
    } else if (error instanceof AxiosError) {
      const status = error.response?.status;
      console.log(`Location ${locationId}: ${status ? `HTTP ${status}` : 'Failed to fetch'}`);
    } else {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.log(`Location ${locationId}: ${errorMsg}`);
    }
    return [];
  }
}

async function main() {
  try {
    // Check command line flags
    const isAnalysisMode = process.argv.includes('--analyze');
    const isDryRun = process.argv.includes('--dry-run');
    const noCleanup = process.argv.includes('--no-cleanup');
    const onlyCleanup = process.argv.includes('--only-cleanup');
    
    if (noCleanup) {
      ENABLE_CLEANUP = false;
      console.log('⚠️  Cleanup disabled via --no-cleanup flag\n');
    }
    
    if (onlyCleanup) {
      ENABLE_CLEANUP = true; // Force enable cleanup for this mode
      console.log('🧹 CLEANUP ONLY MODE - Will only delete beatdowns that no longer exist\n');
    }
    
    if (isDryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made to Firestore\n');
    }
    
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

    // First, fetch all existing beatdowns to track what needs to be migrated/cleaned
    console.log('Fetching existing beatdowns from Firestore...');
    const existingBeatdownsSnapshot = await db.collection('beatdowns').get();
    const existingBeatdowns = new Map();
    existingBeatdownsSnapshot.forEach((doc: admin.firestore.QueryDocumentSnapshot) => {
      existingBeatdowns.set(doc.id, doc.data());
    });
    console.log(`Found ${existingBeatdowns.size} existing beatdowns in Firestore`);

    // Fetch all events from the new API to determine what should exist
    console.log('Fetching events from API...');
    const eventsResponse = await fetchWithRetry<EventsResponse>(EVENTS_URL);
    const events = eventsResponse.events;
    console.log(`Found ${events.length} events in API`);

    // Variables for tracking sync progress (used in both sync and cleanup modes)
    let totalBeatdowns = 0;
    let updatedBeatdowns = 0;
    let newBeatdowns = 0;
    let processedIds = new Set<string>();

    // If only cleanup mode, skip the sync and go straight to cleanup
    if (onlyCleanup) {
      console.log('\n🧹 CLEANUP ONLY MODE - Skipping sync, will only delete obsolete beatdowns\n');
      
      // We still need locations to generate correct beatdown IDs
      console.log('Fetching locations to generate beatdown IDs...');
      const locationsResponse = await fetchWithRetry<LocationsResponse>(LOCATIONS_URL);
      const locationMap = new Map<number, ApiLocation>();
      for (const location of locationsResponse.locations) {
        locationMap.set(location.id, location);
      }
      console.log(`Fetched ${locationMap.size} locations`);
      
      // Generate all valid beatdown IDs from current API data
      console.log('Generating valid beatdown IDs from API data...');
      for (const event of events) {
        const location = locationMap.get(event.locationId);
        if (location) {
          const beatdown = transformEventToBeatdown(event, location);
          const docId = generateBeatdownId(beatdown);
          processedIds.add(docId);
        }
      }
      console.log(`Generated ${processedIds.size} valid beatdown IDs from API`);
      
      // Skip to cleanup section (processedIds is now populated)
    } else {
      console.log('Starting beatdown import...');
      // Get unique location IDs
      const uniqueLocationIds = Array.from(new Set(events.map(e => e.locationId)));
      console.log(`Found ${uniqueLocationIds.length} unique locations`);

      // Fetch ALL locations in one bulk request (much more efficient!)
      console.log('Fetching all locations from API...');
      const locationsResponse = await fetchWithRetry<LocationsResponse>(LOCATIONS_URL);
      const allLocations = locationsResponse.locations;
      console.log(`Fetched ${allLocations.length} total locations from API`);
      
      // Build location map from bulk response
      const locationMap = new Map<number, ApiLocation>();
      for (const location of allLocations) {
        locationMap.set(location.id, location);
      }
      
      // Check if we're missing any locations that events reference
      const missingLocationIds = uniqueLocationIds.filter(id => !locationMap.has(id));
      if (missingLocationIds.length > 0) {
        console.warn(`Warning: ${missingLocationIds.length} locations referenced by events are missing from bulk fetch. Attempting individual fetches...`);
        // Fallback: fetch missing locations individually (should be rare)
        for (const locationId of missingLocationIds.slice(0, 10)) { // Limit to 10 to avoid rate limits
          try {
            const locationUrl = `${LOCATION_URL}/${locationId}`;
            const locationResponse = await fetchWithRetry<LocationResponse>(locationUrl);
            locationMap.set(locationId, locationResponse.location);
          } catch (error) {
            console.warn(`Failed to fetch missing location ${locationId}`);
          }
          await delay(200); // Small delay between individual fetches
        }
      }
      
      console.log(`Location map contains ${locationMap.size} locations (${uniqueLocationIds.length} needed by events)`);

      // Events are already fetched with pageSize=10000, so we have all event data
      // Note: eventTypes are not included in the list endpoint, so they'll be "Unknown"
      // If event types are needed, we'd need to fetch them individually (adds ~6k requests)
      console.log('Transforming events to beatdowns...');
      const beatdowns: Beatdown[] = [];
      for (const event of events) {
        const location = locationMap.get(event.locationId);
        if (location) {
          beatdowns.push(transformEventToBeatdown(event, location));
        } else {
          console.warn(`Location ${event.locationId} not found for event ${event.id}`);
        }
      }
      console.log(`Transformed ${beatdowns.length} beatdowns`);

      // Write to Firestore in batches (or simulate in dry run)
      const beatdownBatches = chunk(beatdowns, BATCH_SIZE);
      
      for (const [batchIndex, beatdownBatch] of beatdownBatches.entries()) {
        if (isDryRun) {
          console.log(`[DRY RUN] Would write batch ${batchIndex + 1}/${beatdownBatches.length} (${beatdownBatch.length} beatdowns)`);
        } else {
          console.log(`Writing batch ${batchIndex + 1}/${beatdownBatches.length} (${beatdownBatch.length} beatdowns)`);
        }
        
        if (!isDryRun) {
          const batch = db.batch();
          
          for (const beatdown of beatdownBatch) {
            const docId = generateBeatdownId(beatdown);
            const docRef = db.collection('beatdowns').doc(docId);
            processedIds.add(docId); // Track all processed IDs for cleanup detection
            
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
        } else {
          // In dry run, just simulate the checks (still need to track processedIds for cleanup detection)
          for (const beatdown of beatdownBatch) {
            const docId = generateBeatdownId(beatdown);
            processedIds.add(docId); // Track all processed IDs for cleanup detection
            
            // Check if document exists
            const doc = await db.collection('beatdowns').doc(docId).get();
            if (doc.exists) {
              updatedBeatdowns++;
            } else {
              newBeatdowns++;
            }
          }
        }
        
        totalBeatdowns += beatdownBatch.length;
      }
    }

    // Cleanup: Delete beatdowns that no longer exist in the API
    if (ENABLE_CLEANUP) {
      const docsToDelete = Array.from(existingBeatdowns.keys()).filter(id => !processedIds.has(id));
      
      if (isDryRun) {
        if (docsToDelete.length > 0) {
          console.log(`\n[DRY RUN] Would delete ${docsToDelete.length} beatdowns (no longer exist in API)`);
          console.log(`[DRY RUN] Sample IDs that would be deleted (first 10):`);
          docsToDelete.slice(0, 10).forEach(id => console.log(`  - ${id}`));
          if (docsToDelete.length > 10) {
            console.log(`  ... and ${docsToDelete.length - 10} more`);
          }
        } else {
          console.log(`\n[DRY RUN] No beatdowns would be deleted (all existing beatdowns are still valid)`);
        }
      } else {
        if (docsToDelete.length > 0) {
          console.log(`\n🧹 Cleaning up deleted beatdowns...`);
          console.log(`Found ${docsToDelete.length} beatdowns to delete (no longer exist in API)`);
          // Delete in batches to stay within Firestore limits
          const deleteBatches = chunk(docsToDelete, BATCH_SIZE);
          
          for (const [deleteBatchIndex, deleteBatch] of deleteBatches.entries()) {
            console.log(`Deleting batch ${deleteBatchIndex + 1}/${deleteBatches.length} (${deleteBatch.length} documents)`);
            const batch = db.batch();
            deleteBatch.forEach(docId => {
              batch.delete(db.collection('beatdowns').doc(docId));
            });
            await batch.commit();
          }
          console.log(`✅ Successfully deleted ${docsToDelete.length} beatdowns that no longer exist in the API`);
        } else {
          console.log('\n✅ No beatdowns to delete - all existing beatdowns are still valid');
        }
      }
    } else {
      if (isDryRun) {
        console.log(`\n[DRY RUN] Cleanup is disabled (use --no-cleanup flag to disable, or remove flag to enable)`);
      } else {
        console.log('\n⚠️  Cleanup skipped (use --no-cleanup flag to disable, or remove flag to enable)');
      }
    }
    
    // Summary
    if (isDryRun) {
      if (!onlyCleanup) {
        console.log(`\n🔍 DRY RUN SUMMARY:`);
        console.log(`Total beatdowns that would be processed: ${totalBeatdowns}`);
        console.log(`New beatdowns that would be created: ${newBeatdowns}`);
        console.log(`Existing beatdowns that would be updated: ${updatedBeatdowns}`);
      }
      console.log(`\n✅ Dry run completed successfully. Run without --dry-run to apply changes.`);
    } else {
      if (onlyCleanup) {
        console.log(`\n✅ Cleanup-only operation completed successfully.`);
      } else {
        console.log(`\n✅ Sync completed successfully.`);
        console.log(`Total beatdowns processed: ${totalBeatdowns}`);
        console.log(`New beatdowns created: ${newBeatdowns}`);
        console.log(`Existing beatdowns updated: ${updatedBeatdowns}`);
      }
    }

  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  }
}

// Run the import
main().catch(console.error); 