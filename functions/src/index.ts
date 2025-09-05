/**
 * F3 Map Webhook Handler
 * 
 * This function handles webhook notifications from the F3 map system
 * for location and event updates.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Request, Response } from 'express';

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

admin.initializeApp();

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
async function fetchLocationData(locationId: number): Promise<any> {
  const startTime = Date.now();
  console.log(`[API] Starting fetch for locationId: ${locationId}`);
  
  try {
    const url = `https://map.f3nation.com/api/trpc/location.getLocationWorkoutData?input=${encodeURIComponent(
      JSON.stringify({ json: { locationId } })
    )}`;
    console.log(`[API] Fetching URL: ${url}`);
    
    const response = await fetch(url);
    const duration = Date.now() - startTime;
    
    console.log(`[API] Response received for locationId ${locationId}: status=${response.status}, duration=${duration}ms`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`[API] Successfully parsed JSON for locationId ${locationId}, has location data: ${!!data?.result?.data?.json?.location}`);
    
    if (data?.result?.data?.json?.location) {
      const location = data.result.data.json.location;
      console.log(`[API] Location ${locationId} data: name="${location.name}", events=${location.events?.length || 0}, active=${location.isActive}`);
    }
    
    return data;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[API] Error fetching locationId ${locationId} after ${duration}ms:`, error);
    throw error;
  }
}

/**
 * Transforms API data into our Beatdown format
 */
function transformToBeatdown(location: Location, event: Event): Beatdown {
  return {
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
  };
}

/**
 * Helper function to generate a consistent document ID
 */
function generateBeatdownId(beatdown: Beatdown): string {
  // Create ID using region name, beatdown name, and day
  const baseString = `${beatdown.region}_${beatdown.name}_${beatdown.dayOfWeek}`;
  // Convert to lowercase and replace spaces/special chars with hyphens
  return baseString.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/**
 * Updates or creates a beatdown document in Firestore
 */
async function updateBeatdown(db: admin.firestore.Firestore, beatdown: Beatdown, existingBeatdown: Beatdown): Promise<void> {
  const docId = generateBeatdownId(beatdown);
  const existingDocId = generateBeatdownId(existingBeatdown);

  // If the existing beatdown doesn't have the same docId, we need to delete the existing document
  if (existingDocId !== docId) {
    await db.collection('beatdowns')
      .doc(existingDocId)
      .delete();
  }

  // Save this beatdown
  await db.collection('beatdowns')
      .doc(docId)
      .set(beatdown, { merge: true });
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
    const locationData = await fetchLocationData(locationId);
    const location = locationData.result.data.json.location;

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

    // Build the list of beatdowns to save and their docIds
    console.log(`[DB] Processing ${location.events?.length || 0} events from API for locationId: ${locationId}`);
    const beatdownsToSave: { docId: string, beatdown: Beatdown }[] = location.events.map((event: Event) => {
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
        writeBatch.set(docRef, beatdown, { merge: true });
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
      console.log(`[DB] Deleting ${docsToDelete.length} beatdowns in ${deleteBatches.length} batches for locationId: ${locationId}`);
      
      for (let i = 0; i < deleteBatches.length; i++) {
        const batch = deleteBatches[i];
        console.log(`[DB] Processing delete batch ${i + 1}/${deleteBatches.length} with ${batch.length} items`);
        const writeBatch = db.batch();
        for (const doc of batch) {
          writeBatch.delete(doc.ref);
        }
        await writeBatch.commit();
        console.log(`[DB] Committed delete batch ${i + 1}/${deleteBatches.length}`);
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
    
    const locationData = await fetchLocationData(existingBeatdown.locationId);
    const location = locationData.result.data.json.location;
    
    if (!location) {
      console.error(`[DB] No location data returned for locationId ${existingBeatdown.locationId} when updating eventId ${eventId}`);
      return;
    }
    
    const event = location.events.find(
      (e: Event) => e.id === eventId
    );

    if (event) {
      console.log(`[DB] Found event ${eventId} ("${event.name}") in location data, updating beatdown`);
      const beatdown = transformToBeatdown(location, event);
      await updateBeatdown(db, beatdown, existingBeatdown);
      const duration = Date.now() - startTime;
      console.log(`[DB] Successfully updated beatdown for eventId ${eventId} in ${duration}ms`);
    } else {
      console.log(`[DB] Event ${eventId} no longer exists in location data, deleting beatdown`);
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
    console.log(`[DB] Deleting ${snapshot.docs.length} beatdowns in ${batches.length} batches for locationId: ${locationId}`);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[DB] Processing delete batch ${i + 1}/${batches.length} with ${batch.length} items`);
      const writeBatch = db.batch();
      batch.forEach(doc => {
        console.log(`[DB] Marking doc ${doc.id} for deletion`);
        writeBatch.delete(doc.ref);
      });
      await writeBatch.commit();
      console.log(`[DB] Committed delete batch ${i + 1}/${batches.length}`);
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
    console.log(`[DB] Deleting ${snapshot.docs.length} beatdowns in ${batches.length} batches for eventId: ${eventId}`);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[DB] Processing delete batch ${i + 1}/${batches.length} with ${batch.length} items`);
      const writeBatch = db.batch();
      batch.forEach(doc => {
        console.log(`[DB] Marking doc ${doc.id} for deletion`);
        writeBatch.delete(doc.ref);
      });
      await writeBatch.commit();
      console.log(`[DB] Committed delete batch ${i + 1}/${batches.length}`);
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
function createWebhookLog(webhookData: MapWebhook): any {
  return {
    ...webhookData,
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    actionedAt: null as admin.firestore.FieldValue | null,
  };
}

export const mapWebhook = functions.https.onRequest(async (req: Request, res: Response) => {
  const webhookStartTime = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
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
