/**
 * F3 Map Webhook Handler
 * 
 * This function handles webhook notifications from the F3 map system
 * for location and event updates.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Request, Response } from 'express';
import { Storage } from '@google-cloud/storage';

interface MapWebhook {
  action: 'map.updated'|'map.deleted';
  channel: string; // e.g. 'prod'
  data: {
    eventId?: number;
    locationId?: number;
    orgId: number;
  };
  receivedAt: string;   // e.g. "June 6, 2025 at 10:21:42 AM UTC-7"
  timestamp: string;    // ISO-8601, e.g. "2025-06-06T17:21:41.825Z"
  version: string;      // e.g. 1.0
};

// New API Types
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
  eventTypes?: ApiEventType[]; // Now included in event list endpoint
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

interface EventResponse {
  event: ApiEvent;
}

interface LocationResponse {
  location: ApiLocation;
}

interface EventsResponse {
  events: ApiEvent[];
}

interface LocationsResponse {
  locations: ApiLocation[];
  totalCount?: number;
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
  lastUpdated?: admin.firestore.FieldValue | admin.firestore.Timestamp | Date;
  deleted?: boolean;
  deletedAt?: admin.firestore.FieldValue | admin.firestore.Timestamp | Date;
}

admin.initializeApp();

// Cloud Storage Configuration
const storage = new Storage();
const BUCKET_NAME = process.env.GCLOUD_STORAGE_BUCKET || `${process.env.GCLOUD_PROJECT}.appspot.com`;
const DATA_PREFIX = 'data';

// API Configuration
const API_BASE_URL = 'https://api.f3nation.com';
// Get API key from environment config - REQUIRED, no default
// firebase functions:config:set f3.api_key="YOURAPIKEY"
// firebase functions:config:set f3.client="f3nearme"
const API_KEY = functions.config().f3?.api_key;
const CLIENT_HEADER = functions.config().f3?.client || 'f3nearme';

if (!API_KEY) {
  throw new Error('F3_API_KEY must be set via Firebase Functions config or environment variable');
}

const API_HEADERS = {
  'Authorization': `Bearer ${API_KEY}`,
  'client': CLIENT_HEADER
};

/**
 * Helper function to format military time to AM/PM
 */
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

/**
 * Fetches location data from the F3 API
 */
async function fetchLocationData(locationId: number): Promise<{ location: ApiLocation; events: ApiEvent[] }> {
  const startTime = Date.now();
  console.log(`[API] Starting fetch for locationId: ${locationId}`);
  
  try {
    // Fetch location details
    const locationUrl = `${API_BASE_URL}/v1/location/id/${locationId}`;
    console.log(`[API] Fetching location URL: ${locationUrl}`);
    
    const locationResponse = await fetch(locationUrl, { headers: API_HEADERS });
    const locationDuration = Date.now() - startTime;
    
    if (!locationResponse.ok) {
      throw new Error(`HTTP ${locationResponse.status}: ${locationResponse.statusText}`);
    }
    
    const locationData: LocationResponse = await locationResponse.json();
    const location = locationData.location;
    console.log(`[API] Location ${locationId} fetched: name="${location.locationName}", active=${location.isActive}, duration=${locationDuration}ms`);
    
    // Fetch all events and filter by locationId
    const eventsUrl = `${API_BASE_URL}/v1/event`;
    console.log(`[API] Fetching events URL: ${eventsUrl}`);
    
    const eventsResponse = await fetch(eventsUrl, { headers: API_HEADERS });
    if (!eventsResponse.ok) {
      throw new Error(`HTTP ${eventsResponse.status}: ${eventsResponse.statusText}`);
    }
    
    const eventsData: EventsResponse = await eventsResponse.json();
    const locationEvents = eventsData.events.filter(e => e.locationId === locationId);
    
    const totalDuration = Date.now() - startTime;
    console.log(`[API] Found ${locationEvents.length} events for locationId ${locationId}, total duration=${totalDuration}ms`);
    
    return {
      location,
      events: locationEvents
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[API] Error fetching locationId ${locationId} after ${duration}ms:`, error);
    throw error;
  }
}

/**
 * Fetches a single event by eventId
 */
async function fetchEventData(eventId: number): Promise<ApiEvent> {
  const startTime = Date.now();
  console.log(`[API] Starting fetch for eventId: ${eventId}`);
  
  try {
    const url = `${API_BASE_URL}/v1/event/id/${eventId}`;
    console.log(`[API] Fetching event URL: ${url}`);
    
    const response = await fetch(url, { headers: API_HEADERS });
    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data: EventResponse = await response.json();
    const event = data.event;
    console.log(`[API] Event ${eventId} fetched: name="${event.name}", duration=${duration}ms`);
    
    return event;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[API] Error fetching eventId ${eventId} after ${duration}ms:`, error);
    throw error;
  }
}

/**
 * Transforms API data into our Beatdown format
 */
function transformToBeatdown(location: ApiLocation, event: ApiEvent): Beatdown {
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
  
  // Get event type name
  const eventType = event.eventTypes?.[0]?.eventTypeName || 'Unknown';
  
  return {
    dayOfWeek: event.dayOfWeek,
    timeString: `${formatTime(event.startTime)} - ${formatTime(event.endTime)}`,
    type: eventType,
    region: regionName,
    website: website,
    notes: event.description || location.description || '',
    name: event.name || event.locationName || location.locationName || '',
    address: address,
    lat: location.latitude,
    long: location.longitude,
    locationId: event.locationId,
    eventId: event.id
  };
}

/**
 * Helper function to generate a consistent document ID
 * IMPORTANT: Must include eventId to handle multiple events per location/day
 * Otherwise, events at the same location on the same day will overwrite each other
 * Using eventId ensures each event gets a unique, stable document ID
 */
function generateBeatdownId(beatdown: Beatdown): string {
  // Create ID using region name, beatdown name, day, and eventId
  // This ensures multiple events at the same location on the same day get unique IDs
  // eventId is stable and unique per event, so it's the best identifier
  const baseString = `${beatdown.region}_${beatdown.name}_${beatdown.dayOfWeek}_${beatdown.eventId}`;
  // Convert to lowercase and replace spaces/special chars with hyphens
  return baseString.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Updates or creates a beatdown document in Firestore
 */
async function updateBeatdown(db: admin.firestore.Firestore, beatdown: Beatdown, existingBeatdown: Beatdown): Promise<void> {
  const docId = generateBeatdownId(beatdown);
  const existingId = generateBeatdownId(existingBeatdown);

  // If the ID changed, soft delete the old document
  if (existingId !== docId) {
    console.log(`[DB] Beatdown ID changed from ${existingId} to ${docId}, soft deleting old document`);
    await db.collection('beatdowns')
      .doc(existingId)
      .update({
        deleted: true,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
  }

  // Save this beatdown with the new ID, setting lastUpdated
  await db.collection('beatdowns')
      .doc(docId)
      .set({
        ...beatdown,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
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

/**
 * Updates all beatdowns for a specific location
 */
async function updateLocationBeatdowns(db: admin.firestore.Firestore, locationId: number): Promise<void> {
  const startTime = Date.now();
  console.log(`[DB] Starting updateLocationBeatdowns for locationId: ${locationId}`);
  
  try {
    const { location, events } = await fetchLocationData(locationId);

    if (!location) {
      console.error(`[DB] No location data returned from API for locationId: ${locationId}`);
      return;
    }

    // Get all existing beatdowns for this location
    console.log(`[DB] Querying existing beatdowns for locationId: ${locationId}`);
    const snapshot = await db.collection('beatdowns')
      .where('locationId', '==', locationId)
      .get();
    
    console.log(`[DB] Found ${snapshot.docs.length} existing beatdowns for locationId: ${locationId}`);

    // Build a map of existing docs by docId
    const existingDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    snapshot.docs.forEach(doc => {
      existingDocs.set(doc.id, doc);
    });

    // Events from the list endpoint now include eventTypes, so no need to fetch individually
    console.log(`[DB] Processing ${events.length} events from API for locationId: ${locationId}`);
    const beatdownsToSave: { docId: string, beatdown: Beatdown }[] = events.map((event: ApiEvent) => {
      const beatdown = transformToBeatdown(location, event);
      const docId = generateBeatdownId(beatdown);
      console.log(`[DB] Transformed event ${event.id} ("${event.name}") to beatdown with docId: ${docId}`);
      return { docId, beatdown };
    });
    const toSaveDocIds = new Set(beatdownsToSave.map(b => b.docId));

    // Debug logging
    console.log(`[DB] Existing doc IDs for locationId ${locationId}:`, Array.from(existingDocs.keys()));
    console.log(`[DB] To-save doc IDs for locationId ${locationId}:`, Array.from(toSaveDocIds));

    // Upsert all beatdowns from the API response
    const saveBatches = chunkArray(beatdownsToSave, BATCH_SIZE);
    console.log(`[DB] Saving ${beatdownsToSave.length} beatdowns in ${saveBatches.length} batches for locationId: ${locationId}`);
    
    for (let i = 0; i < saveBatches.length; i++) {
      const batch = saveBatches[i];
      console.log(`[DB] Processing save batch ${i + 1}/${saveBatches.length} with ${batch.length} items`);
      const writeBatch = db.batch();
      for (const { docId, beatdown } of batch) {
        const docRef = db.collection('beatdowns').doc(docId);
        writeBatch.set(docRef, {
          ...beatdown,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
      await writeBatch.commit();
      console.log(`[DB] Committed save batch ${i + 1}/${saveBatches.length}`);
    }

    // Delete any existing docs not in toSave
    const docsToDelete = Array.from(existingDocs.entries())
      .filter(([docId]) => !toSaveDocIds.has(docId))
      .map(([, doc]) => doc);
    console.log(`[DB] Docs to delete for locationId ${locationId}:`, docsToDelete.map(doc => doc.id));
    
    const deleteBatches = chunkArray(docsToDelete, BATCH_SIZE);
    if (deleteBatches.length > 0) {
      console.log(`[DB] Soft deleting ${docsToDelete.length} beatdowns in ${deleteBatches.length} batches for locationId: ${locationId}`);
      
      for (let i = 0; i < deleteBatches.length; i++) {
        const batch = deleteBatches[i];
        console.log(`[DB] Processing soft delete batch ${i + 1}/${deleteBatches.length} with ${batch.length} items`);
        const writeBatch = db.batch();
        for (const doc of batch) {
          writeBatch.update(doc.ref, {
            deleted: true,
            deletedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        await writeBatch.commit();
        console.log(`[DB] Committed soft delete batch ${i + 1}/${deleteBatches.length}`);
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`[DB] Successfully completed updateLocationBeatdowns for locationId ${locationId} in ${duration}ms: saved=${beatdownsToSave.length}, deleted=${docsToDelete.length}`);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[DB] Error updating location ${locationId} after ${duration}ms:`, error);
    throw error;
  }
}

/**
 * Updates a beatdown for a specific event
 */
async function updateEventBeatdown(db: admin.firestore.Firestore, eventId: number): Promise<void> {
  const startTime = Date.now();
  console.log(`[DB] Starting updateEventBeatdown for eventId: ${eventId}`);
  
  try {
    // First find the existing beatdown to get its locationId
    console.log(`[DB] Querying existing beatdown for eventId: ${eventId}`);
    const snapshot = await db.collection('beatdowns')
      .where('eventId', '==', eventId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.log(`[DB] No existing beatdown found for eventId: ${eventId}`);
      return;
    }

    const existingBeatdown = snapshot.docs[0].data() as Beatdown;
    console.log(`[DB] Found existing beatdown for eventId ${eventId}: locationId=${existingBeatdown.locationId}, docId=${snapshot.docs[0].id}`);
    
    // Fetch the event details (eventTypes are now included in individual event fetch)
    const event = await fetchEventData(eventId);
    
    // Fetch location details
    const { location } = await fetchLocationData(existingBeatdown.locationId);
    
    if (!location) {
      console.error(`[DB] No location data returned for locationId ${existingBeatdown.locationId} when updating eventId ${eventId}`);
      return;
    }

    if (event && event.isActive) {
      console.log(`[DB] Found active event ${eventId} ("${event.name}"), updating beatdown`);
      const beatdown = transformToBeatdown(location, event);
      await updateBeatdown(db, beatdown, existingBeatdown);
      const duration = Date.now() - startTime;
      console.log(`[DB] Successfully updated beatdown for eventId ${eventId} in ${duration}ms`);
    } else {
      console.log(`[DB] Event ${eventId} no longer exists or is inactive, deleting beatdown`);
      await deleteBeatdownsByEvent(db, eventId);
      const duration = Date.now() - startTime;
      console.log(`[DB] Successfully deleted beatdown for eventId ${eventId} in ${duration}ms`);
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[DB] Error updating event ${eventId} after ${duration}ms:`, error);
    throw error;
  }
}

/**
 * Deletes beatdowns by location ID
 */
async function deleteBeatdownsByLocation(db: admin.firestore.Firestore, locationId: number): Promise<void> {
  const startTime = Date.now();
  console.log(`[DB] Starting deleteBeatdownsByLocation for locationId: ${locationId}`);
  
  try {
    const snapshot = await db.collection('beatdowns')
      .where('locationId', '==', locationId)
      .get();
    
    console.log(`[DB] Found ${snapshot.docs.length} beatdowns to delete for locationId: ${locationId}`);
    
    if (snapshot.docs.length === 0) {
      console.log(`[DB] No beatdowns found to delete for locationId: ${locationId}`);
      return;
    }
    
    const batches = chunkArray(snapshot.docs, BATCH_SIZE);
    console.log(`[DB] Soft deleting ${snapshot.docs.length} beatdowns in ${batches.length} batches for locationId: ${locationId}`);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[DB] Processing soft delete batch ${i + 1}/${batches.length} with ${batch.length} items`);
      const writeBatch = db.batch();
      batch.forEach(doc => {
        console.log(`[DB] Marking doc ${doc.id} for soft deletion`);
        writeBatch.update(doc.ref, {
          deleted: true,
          deletedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      await writeBatch.commit();
      console.log(`[DB] Committed soft delete batch ${i + 1}/${batches.length}`);
    }
    
    const duration = Date.now() - startTime;
    console.log(`[DB] Successfully deleted ${snapshot.docs.length} beatdowns for locationId ${locationId} in ${duration}ms`);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[DB] Error deleting location ${locationId} after ${duration}ms:`, error);
    throw error;
  }
}

/**
 * Deletes beatdowns by event ID
 */
async function deleteBeatdownsByEvent(db: admin.firestore.Firestore, eventId: number): Promise<void> {
  const startTime = Date.now();
  console.log(`[DB] Starting deleteBeatdownsByEvent for eventId: ${eventId}`);
  
  try {
    const snapshot = await db.collection('beatdowns')
      .where('eventId', '==', eventId)
      .get();
    
    console.log(`[DB] Found ${snapshot.docs.length} beatdowns to delete for eventId: ${eventId}`);
    
    if (snapshot.docs.length === 0) {
      console.log(`[DB] No beatdowns found to delete for eventId: ${eventId}`);
      return;
    }
    
    const batches = chunkArray(snapshot.docs, BATCH_SIZE);
    console.log(`[DB] Soft deleting ${snapshot.docs.length} beatdowns in ${batches.length} batches for eventId: ${eventId}`);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[DB] Processing soft delete batch ${i + 1}/${batches.length} with ${batch.length} items`);
      const writeBatch = db.batch();
      batch.forEach(doc => {
        console.log(`[DB] Marking doc ${doc.id} for soft deletion`);
        writeBatch.update(doc.ref, {
          deleted: true,
          deletedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      await writeBatch.commit();
      console.log(`[DB] Committed soft delete batch ${i + 1}/${batches.length}`);
    }
    
    const duration = Date.now() - startTime;
    console.log(`[DB] Successfully deleted ${snapshot.docs.length} beatdowns for eventId ${eventId} in ${duration}ms`);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[DB] Error deleting event ${eventId} after ${duration}ms:`, error);
    throw error;
  }
}

/**
 * Creates a webhook log entry
 */
interface WebhookLog {
  action: 'map.updated'|'map.deleted';
  channel: string;
  data: {
    eventId?: number;
    locationId?: number;
    orgId: number;
  };
  receivedAt: admin.firestore.FieldValue | string | null;
  timestamp: string;
  version: string;
  actionedAt: admin.firestore.FieldValue | null;
  rerunAt?: admin.firestore.FieldValue;
  error?: any;
}

function createWebhookLog(webhookData: MapWebhook): WebhookLog {
  return {
    ...webhookData,
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    actionedAt: null as admin.firestore.FieldValue | null,
  };
}

/**
 * Admin callable function to get all location IDs from the F3 map
 */
export const adminGetAllLocationIds = functions.https.onCall(async (data) => {
  const startTime = Date.now();
  console.log(`[ADMIN] Get all location IDs callable request`);

  try {
    console.log(`[ADMIN] Fetching all events from F3 API`);
    
    const url = `${API_BASE_URL}/v1/event`;
    const response = await fetch(url, { headers: API_HEADERS });
    
    if (!response.ok) {
      throw new functions.https.HttpsError('internal', `HTTP ${response.status}: ${response.statusText}`);
    }
    
    const apiData: EventsResponse = await response.json();
    
    if (!apiData?.events || !Array.isArray(apiData.events)) {
      throw new functions.https.HttpsError('internal', 'Invalid response format from F3 API');
    }
    
    // Extract unique location IDs from events
    const uniqueLocationIds = new Set<number>();
    
    apiData.events.forEach((event: ApiEvent) => {
      if (event.locationId && typeof event.locationId === 'number') {
        uniqueLocationIds.add(event.locationId);
      }
    });
    
    const locationIds = Array.from(uniqueLocationIds).sort((a, b) => a - b);
    const duration = Date.now() - startTime;
    
    console.log(`[ADMIN] Found ${locationIds.length} unique location IDs in ${duration}ms`);
    
    return {
      message: 'Successfully retrieved location IDs',
      count: locationIds.length,
      locationIds,
      duration
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[ADMIN] Error getting location IDs after ${duration}ms:`, error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', 'Failed to get location IDs');
  }
});

/**
 * Admin callable function to update a single location by locationId
 */
export const adminUpdateSingleLocation = functions.https.onCall(async (data) => {
  const startTime = Date.now();
  console.log(`[ADMIN] Update single location callable request`);

  try {
    const { locationId } = data;
    
    if (!locationId || typeof locationId !== 'number') {
      throw new functions.https.HttpsError('invalid-argument', 'locationId is required and must be a number');
    }

    console.log(`[ADMIN] Updating single location: ${locationId}`);
    
    const db = admin.firestore();
    await updateLocationBeatdowns(db, locationId);
    
    const duration = Date.now() - startTime;
    console.log(`[ADMIN] Successfully updated location ${locationId} in ${duration}ms`);
    
    return {
      message: 'Location updated successfully',
      locationId,
      duration
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[ADMIN] Error updating single location after ${duration}ms:`, error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', error instanceof Error ? error.message : 'Failed to update location');
  }
});

/**
 * Admin callable function to re-run webhooks after a specific date
 */
export const adminRerunWebhooks = functions.https.onCall(async (data) => {
  const startTime = Date.now();
  console.log(`[ADMIN] Re-run webhooks callable request`);

  try {
    const { afterDate, dryRun = false } = data;
    
    if (!afterDate) {
      throw new functions.https.HttpsError('invalid-argument', 'afterDate is required (ISO string)');
    }

    const afterTimestamp = new Date(afterDate);
    console.log(`[ADMIN] Re-running webhooks after: ${afterTimestamp.toISOString()}, dryRun: ${dryRun}`);

    const db = admin.firestore();
    const webhookLogs = await db.collection('webhookLogs')
      .where('timestamp', '>=', afterTimestamp.toISOString())
      .where('channel', '==', 'prod')
      .orderBy('timestamp', 'desc')
      .get();

    console.log(`[ADMIN] Found ${webhookLogs.docs.length} webhook logs to process`);
    
    const results = [];
    let processed = 0;
    let errors = 0;

    for (const doc of webhookLogs.docs) {
      const webhookData = doc.data() as WebhookLog;
      
      // Skip if already actioned successfully (has actionedAt and no error)
      if (webhookData.actionedAt && !webhookData.error) {
        continue;
      }

      console.log(`[ADMIN] Processing webhook ${doc.id}: action=${webhookData.action}, locationId=${webhookData.data?.locationId}, eventId=${webhookData.data?.eventId}`);
      
      if (!dryRun) {
        try {
          const { locationId, eventId } = webhookData.data;
          
          if (webhookData.action === 'map.updated') {
            if (locationId) {
              await updateLocationBeatdowns(db, locationId);
            } else if (eventId) {
              await updateEventBeatdown(db, eventId);
            }
          } else if (webhookData.action === 'map.deleted') {
            if (locationId) {
              await deleteBeatdownsByLocation(db, locationId);
            } else if (eventId) {
              await deleteBeatdownsByEvent(db, eventId);
            }
          }
          
          // Update the webhook log to mark as actioned
          await doc.ref.update({
            actionedAt: admin.firestore.FieldValue.serverTimestamp(),
            rerunAt: admin.firestore.FieldValue.serverTimestamp(),
            error: admin.firestore.FieldValue.delete()
          });
          
          processed++;
        } catch (error) {
          console.error(`[ADMIN] Error processing webhook ${doc.id}:`, error);
          errors++;
          
          // Update with error info
          await doc.ref.update({
            rerunAt: admin.firestore.FieldValue.serverTimestamp(),
            error: {
              message: error instanceof Error ? error.message : String(error),
              rerunError: true
            }
          });
        }
      }
      
      results.push({
        id: doc.id,
        action: webhookData.action,
        locationId: webhookData.data?.locationId,
        eventId: webhookData.data?.eventId,
        timestamp: webhookData.timestamp,
        processed: !dryRun
      });
    }

    const duration = Date.now() - startTime;
    console.log(`[ADMIN] Completed webhook rerun in ${duration}ms: ${processed} processed, ${errors} errors`);
    
    return {
      message: `Webhook rerun ${dryRun ? 'simulation' : 'execution'} completed`,
      afterDate: afterTimestamp.toISOString(),
      totalFound: webhookLogs.docs.length,
      candidatesForRerun: results.length,
      processed,
      errors,
      duration,
      dryRun,
      results
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[ADMIN] Error in webhook rerun after ${duration}ms:`, error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', error instanceof Error ? error.message : 'Failed to rerun webhooks');
  }
});

/**
 * Admin callable function to refresh specific locations
 */
export const adminRefreshSpecificLocations = functions.https.onCall(async (data) => {
  const startTime = Date.now();
  console.log(`[ADMIN] Refresh specific locations callable request`);

  try {
    const { locationIds, dryRun = false } = data;
    
    if (!locationIds || !Array.isArray(locationIds) || locationIds.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'locationIds array is required and must not be empty');
    }

    const targetLocationIds: number[] = locationIds;
    console.log(`[ADMIN] Refreshing ${targetLocationIds.length} specific locations, dryRun: ${dryRun}`);
    
    if (dryRun) {
      return {
        message: 'Location refresh simulation completed',
        locationIds: targetLocationIds,
        count: targetLocationIds.length,
        dryRun: true
      };
    }

    const db = admin.firestore();
    const results = [];
    let processed = 0;
    let errors = 0;

    // Process locations in parallel batches to avoid overwhelming the API
    const BATCH_SIZE = 10;
    const batches = [];
    for (let i = 0; i < targetLocationIds.length; i += BATCH_SIZE) {
      batches.push(targetLocationIds.slice(i, i + BATCH_SIZE));
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`[ADMIN] Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} locations`);
      
      const batchPromises = batch.map(async (locationId) => {
        try {
          console.log(`[ADMIN] Refreshing location ${locationId}`);
          await updateLocationBeatdowns(db, locationId);
          processed++;
          return { locationId, success: true };
        } catch (error) {
          console.error(`[ADMIN] Error refreshing location ${locationId}:`, error);
          errors++;
          return { 
            locationId, 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches to be nice to the API
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[ADMIN] Completed location refresh in ${duration}ms: ${processed} processed, ${errors} errors`);
    
    return {
      message: 'Location refresh completed',
      totalLocations: targetLocationIds.length,
      processed,
      errors,
      duration,
      results
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[ADMIN] Error in location refresh after ${duration}ms:`, error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', error instanceof Error ? error.message : 'Failed to refresh locations');
  }
});


export const mapWebhook = functions.https.onRequest(async (req: Request, res: Response) => {
  const webhookStartTime = Date.now();
  const requestId = Math.random().toString(36).substring(2, 11);
  console.log(`[WEBHOOK:${requestId}] Received ${req.method} request from ${req.ip || 'unknown'} at ${new Date().toISOString()}`);
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    console.log(`[WEBHOOK:${requestId}] Rejected non-POST request: ${req.method}`);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const webhookData = req.body as MapWebhook;
    console.log(`[WEBHOOK:${requestId}] Webhook data:`, JSON.stringify({
      action: webhookData.action,
      channel: webhookData.channel,
      locationId: webhookData.data?.locationId,
      eventId: webhookData.data?.eventId,
      orgId: webhookData.data?.orgId,
      timestamp: webhookData.timestamp,
      version: webhookData.version
    }, null, 2));
    
    const webhookLog = createWebhookLog(webhookData);
    let actionTaken = false;
    
    // Only process prod channel webhooks
    if (webhookData.channel === 'prod') {
      console.log(`[WEBHOOK:${requestId}] Processing prod channel webhook`);
      const db = admin.firestore();
      const { locationId, eventId } = webhookData.data;
      
      if (webhookData.action === 'map.updated') {
        console.log(`[WEBHOOK:${requestId}] Processing map.updated action`);
        
        if (locationId) {
          console.log(`[WEBHOOK:${requestId}] Updating location beatdowns: ${locationId}`);
          await updateLocationBeatdowns(db, locationId);
          actionTaken = true;
        } else if (eventId) {
          console.log(`[WEBHOOK:${requestId}] Updating single event: ${eventId}`);
          await updateEventBeatdown(db, eventId);
          actionTaken = true;
        } else {
          console.warn(`[WEBHOOK:${requestId}] map.updated action received but no locationId or eventId provided`);
        }
        
      } else if (webhookData.action === 'map.deleted') {
        console.log(`[WEBHOOK:${requestId}] Processing map.deleted action`);
        
        if (locationId) {
          console.log(`[WEBHOOK:${requestId}] Deleting location beatdowns: ${locationId}`);
          await deleteBeatdownsByLocation(db, locationId);
          actionTaken = true;
        } else if (eventId) {
          console.log(`[WEBHOOK:${requestId}] Deleting event beatdowns: ${eventId}`);
          await deleteBeatdownsByEvent(db, eventId);
          actionTaken = true;
        } else {
          console.warn(`[WEBHOOK:${requestId}] map.deleted action received but no locationId or eventId provided`);
        }
      } else {
        console.warn(`[WEBHOOK:${requestId}] Unknown action: ${webhookData.action}`);
      }
      
      if (actionTaken) {
        webhookLog.actionedAt = admin.firestore.FieldValue.serverTimestamp();
        console.log(`[WEBHOOK:${requestId}] Action completed successfully`);
        
        // Regenerate JSON cache after successful update
        console.log(`[WEBHOOK:${requestId}] Triggering JSON cache regeneration`);
        try {
          await generateJsonCache(db);
          console.log(`[WEBHOOK:${requestId}] JSON cache regenerated successfully`);
        } catch (jsonError) {
          console.error(`[WEBHOOK:${requestId}] Error regenerating JSON cache:`, jsonError);
          // Don't fail the webhook if JSON generation fails
        }
      }
      
    } else {
      console.log(`[WEBHOOK:${requestId}] Ignoring non-prod channel: ${webhookData.channel}`);
    }

    // Store in Firestore
    console.log(`[WEBHOOK:${requestId}] Storing webhook log in Firestore`);
    const logRef = await admin.firestore()
      .collection('webhookLogs')
      .add(webhookLog);
    console.log(`[WEBHOOK:${requestId}] Webhook log stored with ID: ${logRef.id}`);

    const totalDuration = Date.now() - webhookStartTime;
    console.log(`[WEBHOOK:${requestId}] Webhook processed successfully in ${totalDuration}ms (action taken: ${actionTaken})`);
    
    res.status(200).json({ 
      message: 'Webhook received and processed successfully',
      requestId,
      duration: totalDuration,
      actionTaken,
      logId: logRef.id
    });
    
  } catch (error) {
    const totalDuration = Date.now() - webhookStartTime;
    console.error(`[WEBHOOK:${requestId}] Error processing webhook after ${totalDuration}ms:`, error);
    
    // Try to log the error webhook
    try {
      const errorLog = {
        ...req.body,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        actionedAt: null,
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          duration: totalDuration
        }
      };
      await admin.firestore()
        .collection('webhookLogs')
        .add(errorLog);
      console.log(`[WEBHOOK:${requestId}] Error webhook logged to Firestore`);
    } catch (logError) {
      console.error(`[WEBHOOK:${requestId}] Failed to log error webhook:`, logError);
    }
    
    res.status(500).json({ 
      error: 'Internal server error',
      requestId,
      duration: totalDuration
    });
  }
});

/**
 * Generate JSON cache file from Firestore and upload to Cloud Storage
 * Creates: /data/all.json - all active beatdowns
 */
async function generateJsonCache(db: admin.firestore.Firestore): Promise<void> {
  const startTime = Date.now();
  console.log(`[JSON] Starting JSON cache generation`);
  
  try {
    // Get all beatdowns from Firestore (we'll filter deleted in memory)
    // Note: We can't use .where('deleted', '==', false) because it excludes
    // documents where the 'deleted' field doesn't exist
    const snapshot = await db.collection('beatdowns').get();
    
    console.log(`[JSON] Found ${snapshot.docs.length} total beatdowns in Firestore`);
    
    // Transform to beatdown objects, filter out deleted, and serialize timestamps
    const beatdowns: Array<Beatdown & { id: string }> = snapshot.docs
      .map(doc => {
        const data = doc.data() as Beatdown;
        return { ...data, id: doc.id };
      })
      .filter(bd => !bd.deleted) // Filter out deleted beatdowns (same as app does)
      .map(bd => {
        // Convert Firestore Timestamps to ISO strings for JSON serialization
        const serialized: any = { ...bd };
        if (serialized.lastUpdated && serialized.lastUpdated.toDate) {
          serialized.lastUpdated = serialized.lastUpdated.toDate().toISOString();
        } else if (serialized.lastUpdated instanceof Date) {
          serialized.lastUpdated = serialized.lastUpdated.toISOString();
        }
        if (serialized.deletedAt && serialized.deletedAt.toDate) {
          serialized.deletedAt = serialized.deletedAt.toDate().toISOString();
        } else if (serialized.deletedAt instanceof Date) {
          serialized.deletedAt = serialized.deletedAt.toISOString();
        }
        return serialized;
      });
    
    console.log(`[JSON] Filtered to ${beatdowns.length} active beatdowns (excluded ${snapshot.docs.length - beatdowns.length} deleted)`);
    
    const bucket = storage.bucket(BUCKET_NAME);
    
    // Generate all.json - all beatdowns
    const allJson = JSON.stringify(beatdowns, null, 2);
    const allFile = bucket.file(`${DATA_PREFIX}/all.json`);
    await allFile.save(allJson, {
      contentType: 'application/json',
      metadata: {
        cacheControl: 'public, max-age=3600', // Cache for 1 hour
      },
    });
    await allFile.makePublic();
    console.log(`[JSON] Uploaded all.json (${beatdowns.length} beatdowns)`);
    
    const duration = Date.now() - startTime;
    console.log(`[JSON] Successfully generated JSON cache in ${duration}ms`);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[JSON] Error generating JSON cache after ${duration}ms:`, error);
    throw error;
  }
}

/**
 * Callable function to manually regenerate JSON cache
 */
export const adminRegenerateJsonCache = functions.https.onCall(async (data) => {
  const startTime = Date.now();
  console.log(`[ADMIN] Regenerate JSON cache callable request`);
  
  try {
    const db = admin.firestore();
    await generateJsonCache(db);
    
    const duration = Date.now() - startTime;
    console.log(`[ADMIN] Successfully regenerated JSON cache in ${duration}ms`);
    
    return {
      message: 'JSON cache regenerated successfully',
      duration
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[ADMIN] Error regenerating JSON cache after ${duration}ms:`, error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', error instanceof Error ? error.message : 'Failed to regenerate JSON cache');
  }
});

/**
 * Scheduled function to regenerate JSON cache hourly
 */
export const scheduledRegenerateJsonCache = functions.pubsub
  .schedule('every 1 hours')
  .timeZone('UTC')
  .onRun(async (context) => {
    console.log(`[SCHEDULED] Starting scheduled JSON cache regeneration`);
    const db = admin.firestore();
    await generateJsonCache(db);
    console.log(`[SCHEDULED] Completed scheduled JSON cache regeneration`);
  });

/**
 * Helper function to delay execution
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Helper function to make API calls with retry logic for rate limits
 */
async function fetchWithRetry(url: string, retryCount: number = 0, maxRetries: number = 3): Promise<any> {
  try {
    const response = await fetch(url, {
      headers: API_HEADERS
    });
    
    if (!response.ok) {
      if (response.status === 429) {
        // Rate limit - wait and retry
        const waitTime = 10000; // 10 seconds default
        if (retryCount < maxRetries) {
          console.log(`⏳ Rate limit exceeded. Waiting ${waitTime / 1000}s before retry ${retryCount + 1}/${maxRetries}...`);
          await delay(waitTime);
          return fetchWithRetry(url, retryCount + 1, maxRetries);
        } else {
          throw new Error(`Rate limit exceeded after ${maxRetries} retries`);
        }
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    if (retryCount < maxRetries && error instanceof Error && error.message.includes('Rate limit')) {
      const waitTime = 10000;
      await delay(waitTime);
      return fetchWithRetry(url, retryCount + 1, maxRetries);
    }
    throw error;
  }
}

/**
 * Helper function to normalize values for comparison
 */
function normalizeValue(val: any): any {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    // For integers (locationId, eventId), compare as integers
    if (Number.isInteger(val)) {
      return val;
    }
    // For floats (lat, long), round to 5 decimal places (~1.1 meters precision)
    return Math.round(val * 100000) / 100000;
  }
  // Convert to string and trim for string comparison
  return String(val).trim();
}

/**
 * Helper function to check if two coordinates are effectively the same
 */
function coordinatesAreEqual(lat1: number, long1: number, lat2: number, long2: number): boolean {
  const normalizedLat1 = normalizeValue(lat1);
  const normalizedLong1 = normalizeValue(long1);
  const normalizedLat2 = normalizeValue(lat2);
  const normalizedLong2 = normalizeValue(long2);
  
  // If normalized values match, they're equal
  if (normalizedLat1 === normalizedLat2 && normalizedLong1 === normalizedLong2) {
    return true;
  }
  
  // Calculate distance in meters (Haversine formula approximation for small distances)
  const latDiff = Math.abs(lat1 - lat2) * 111000;
  const longDiff = Math.abs(long1 - long2) * 111000 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
  const distance = Math.sqrt(latDiff * latDiff + longDiff * longDiff);
  
  // Consider coordinates equal if within 10 meters
  return distance < 10;
}

/**
 * Helper function to compare beatdowns and check if they're different
 */
function beatdownsAreEqual(bd1: Beatdown, bd2: Beatdown): boolean {
  return (
    normalizeValue(bd1.dayOfWeek) === normalizeValue(bd2.dayOfWeek) &&
    normalizeValue(bd1.timeString) === normalizeValue(bd2.timeString) &&
    normalizeValue(bd1.type) === normalizeValue(bd2.type) &&
    normalizeValue(bd1.region) === normalizeValue(bd2.region) &&
    normalizeValue(bd1.website) === normalizeValue(bd2.website) &&
    normalizeValue(bd1.notes) === normalizeValue(bd2.notes) &&
    normalizeValue(bd1.name) === normalizeValue(bd2.name) &&
    normalizeValue(bd1.address) === normalizeValue(bd2.address) &&
    coordinatesAreEqual(bd1.lat, bd1.long, bd2.lat, bd2.long)
  );
}

/**
 * Full sync function that replicates the sync-beatdowns.ts script
 * Fetches all events and locations from API, compares with Firestore,
 * and only writes changes. Also cleans up deleted beatdowns.
 */
async function syncAllBeatdowns(db: admin.firestore.Firestore): Promise<void> {
  const startTime = Date.now();
  console.log(`[SYNC] Starting full beatdown sync`);
  
  try {
    // Fetch all existing beatdowns
    console.log(`[SYNC] Fetching existing beatdowns from Firestore...`);
    const existingBeatdownsSnapshot = await db.collection('beatdowns').get();
    const existingBeatdowns = new Map<string, Beatdown>();
    existingBeatdownsSnapshot.forEach((doc) => {
      existingBeatdowns.set(doc.id, doc.data() as Beatdown);
    });
    console.log(`[SYNC] Found ${existingBeatdowns.size} existing beatdowns in Firestore`);

    // Fetch all events from API
    console.log(`[SYNC] Fetching events from API...`);
    const EVENTS_URL = `${API_BASE_URL}/v1/event?pageSize=100000`;
    const eventsResponse = await fetchWithRetry(EVENTS_URL) as EventsResponse;
    const events = eventsResponse.events;
    console.log(`[SYNC] Found ${events.length} events in API`);

    // Fetch all locations from API
    console.log(`[SYNC] Fetching locations from API...`);
    const LOCATIONS_URL = `${API_BASE_URL}/v1/location`;
    const locationsResponse = await fetchWithRetry(LOCATIONS_URL) as LocationsResponse;
    const locationMap = new Map<number, ApiLocation>();
    for (const location of locationsResponse.locations) {
      locationMap.set(location.id, location);
    }
    console.log(`[SYNC] Fetched ${locationMap.size} locations from API`);

    // Transform events to beatdowns
    console.log(`[SYNC] Transforming events to beatdowns...`);
    const beatdowns: Beatdown[] = [];
    for (const event of events) {
      const location = locationMap.get(event.locationId);
      if (location) {
        beatdowns.push(transformToBeatdown(location, event));
      } else {
        console.warn(`[SYNC] Location ${event.locationId} not found for event ${event.id}`);
      }
    }
    console.log(`[SYNC] Transformed ${beatdowns.length} beatdowns`);

    // Compare beatdowns and find changes
    console.log(`[SYNC] Comparing beatdowns with existing data...`);
    const beatdownsToWrite: Beatdown[] = [];
    let newBeatdowns = 0;
    let updatedBeatdowns = 0;
    let skippedUnchanged = 0;
    const processedIds = new Set<string>();

    for (const beatdown of beatdowns) {
      const docId = generateBeatdownId(beatdown);
      processedIds.add(docId);
      
      const existingBeatdown = existingBeatdowns.get(docId);
      
      if (!existingBeatdown) {
        // New beatdown
        beatdownsToWrite.push(beatdown);
        newBeatdowns++;
      } else if (!beatdownsAreEqual(existingBeatdown, beatdown)) {
        // Changed beatdown
        beatdownsToWrite.push(beatdown);
        updatedBeatdowns++;
      } else if (!existingBeatdown.lastUpdated) {
        // Unchanged but missing lastUpdated - add it
        beatdownsToWrite.push(beatdown);
        updatedBeatdowns++;
      } else {
        // Unchanged - skip
        skippedUnchanged++;
      }
    }

    console.log(`[SYNC] Found ${beatdownsToWrite.length} beatdowns to write (${newBeatdowns} new, ${updatedBeatdowns} updated, ${skippedUnchanged} unchanged)`);

    // Write beatdowns in batches
    if (beatdownsToWrite.length > 0) {
      const beatdownBatches = chunkArray(beatdownsToWrite, BATCH_SIZE);
      
      for (const [batchIndex, beatdownBatch] of beatdownBatches.entries()) {
        console.log(`[SYNC] Writing batch ${batchIndex + 1}/${beatdownBatches.length} (${beatdownBatch.length} beatdowns)`);
        
        const batch = db.batch();
        for (const beatdown of beatdownBatch) {
          const docId = generateBeatdownId(beatdown);
          const docRef = db.collection('beatdowns').doc(docId);
          batch.set(docRef, {
            ...beatdown,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
        await batch.commit();
      }
    } else {
      console.log(`[SYNC] No beatdowns need to be written - all are up to date`);
    }

    // Cleanup: Soft delete beatdowns that no longer exist in API
    console.log(`[SYNC] Cleaning up deleted beatdowns...`);
    const docsToDelete = Array.from(existingBeatdowns.keys()).filter(id => !processedIds.has(id));
    
    if (docsToDelete.length > 0) {
      console.log(`[SYNC] Found ${docsToDelete.length} beatdowns to soft delete`);
      const deleteBatches = chunkArray(docsToDelete, BATCH_SIZE);
      
      for (const [deleteBatchIndex, deleteBatch] of deleteBatches.entries()) {
        console.log(`[SYNC] Soft deleting batch ${deleteBatchIndex + 1}/${deleteBatches.length} (${deleteBatch.length} documents)`);
        const batch = db.batch();
        deleteBatch.forEach(docId => {
          const docRef = db.collection('beatdowns').doc(docId);
          batch.update(docRef, {
            deleted: true,
            deletedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
      }
      console.log(`[SYNC] Successfully soft deleted ${docsToDelete.length} beatdowns`);
    } else {
      console.log(`[SYNC] No beatdowns to delete - all existing beatdowns are still valid`);
    }

    const duration = Date.now() - startTime;
    console.log(`[SYNC] Sync completed successfully in ${duration}ms`);
    console.log(`[SYNC] Summary: ${newBeatdowns} new, ${updatedBeatdowns} updated, ${skippedUnchanged} unchanged, ${docsToDelete.length} deleted`);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[SYNC] Error during sync after ${duration}ms:`, error);
    throw error;
  }
}

/**
 * Scheduled function to sync all beatdowns hourly (equivalent to running npm run sync)
 */
export const scheduledSyncAllBeatdowns = functions.pubsub
  .schedule('every 1 hours')
  .timeZone('UTC')
  .onRun(async (context) => {
    console.log(`[SCHEDULED] Starting scheduled beatdown sync`);
    const db = admin.firestore();
    await syncAllBeatdowns(db);
    console.log(`[SCHEDULED] Completed scheduled beatdown sync`);
    
    // Also regenerate JSON cache after sync
    console.log(`[SCHEDULED] Regenerating JSON cache after sync`);
    await generateJsonCache(db);
    console.log(`[SCHEDULED] Completed JSON cache regeneration`);
  });

/**
 * Callable function to manually trigger full sync
 */
export const adminSyncAllBeatdowns = functions.https.onCall(async (data) => {
  const startTime = Date.now();
  console.log(`[ADMIN] Sync all beatdowns callable request`);
  
  try {
    const db = admin.firestore();
    await syncAllBeatdowns(db);
    
    // Also regenerate JSON cache after sync
    await generateJsonCache(db);
    
    const duration = Date.now() - startTime;
    console.log(`[ADMIN] Successfully completed sync and JSON cache regeneration in ${duration}ms`);
    
    return {
      message: 'Sync completed successfully',
      duration
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[ADMIN] Error during sync after ${duration}ms:`, error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', error instanceof Error ? error.message : 'Failed to sync beatdowns');
  }
});
