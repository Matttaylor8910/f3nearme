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
  const response = await fetch(
    `https://map.f3nation.com/api/trpc/location.getLocationWorkoutData?input=${encodeURIComponent(
      JSON.stringify({ json: { locationId } })
    )}`
  );
  return response.json();
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
  try {
    const locationData = await fetchLocationData(locationId);
    const location = locationData.result.data.json.location;

    // Get all existing beatdowns for this location
    const snapshot = await db.collection('beatdowns')
      .where('locationId', '==', locationId)
      .get();

    // Build a map of existing docs by docId
    const existingDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    snapshot.docs.forEach(doc => {
      existingDocs.set(doc.id, doc);
    });

    // Build the list of beatdowns to save and their docIds
    const beatdownsToSave: { docId: string, beatdown: Beatdown }[] = location.events.map((event: Event) => {
      const beatdown = transformToBeatdown(location, event);
      const docId = generateBeatdownId(beatdown);
      return { docId, beatdown };
    });
    const toSaveDocIds = new Set(beatdownsToSave.map(b => b.docId));

    // Debug logging
    console.log('Existing doc IDs:', Array.from(existingDocs.keys()));
    console.log('To-save doc IDs:', Array.from(toSaveDocIds));

    // Upsert all beatdowns from the API response
    const saveBatches = chunkArray(beatdownsToSave, BATCH_SIZE);
    for (const batch of saveBatches) {
      const writeBatch = db.batch();
      for (const { docId, beatdown } of batch) {
        const docRef = db.collection('beatdowns').doc(docId);
        writeBatch.set(docRef, beatdown, { merge: true });
      }
      await writeBatch.commit();
    }

    // Delete any existing docs not in toSave
    const docsToDelete = Array.from(existingDocs.entries())
      .filter(([docId]) => !toSaveDocIds.has(docId))
      .map(([, doc]) => doc);
    console.log('Docs to delete:', docsToDelete.map(doc => doc.id));
    const deleteBatches = chunkArray(docsToDelete, BATCH_SIZE);
    for (const batch of deleteBatches) {
      const writeBatch = db.batch();
      for (const doc of batch) {
        writeBatch.delete(doc.ref);
      }
      await writeBatch.commit();
    }
  } catch (error) {
    console.error(`Error updating location ${locationId}:`, error);
    throw error;
  }
}

/**
 * Updates a beatdown for a specific event
 */
async function updateEventBeatdown(db: admin.firestore.Firestore, eventId: number): Promise<void> {
  try {
    // First find the existing beatdown to get its locationId
    const snapshot = await db.collection('beatdowns')
      .where('eventId', '==', eventId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.log(`No existing beatdown found for eventId: ${eventId}`);
      return;
    }

    const existingBeatdown = snapshot.docs[0].data() as Beatdown;
    const locationData = await fetchLocationData(existingBeatdown.locationId);
    const location = locationData.result.data.json.location;
    
    const event = location.events.find(
      (e: Event) => e.id === eventId
    );

    if (event) {
      const beatdown = transformToBeatdown(location, event);
      await updateBeatdown(db, beatdown, existingBeatdown);
    } else {
      // Event no longer exists, delete the beatdown
      await deleteBeatdownsByEvent(db, eventId);
    }
  } catch (error) {
    console.error(`Error updating event ${eventId}:`, error);
    throw error;
  }
}

/**
 * Deletes beatdowns by location ID
 */
async function deleteBeatdownsByLocation(db: admin.firestore.Firestore, locationId: number): Promise<void> {
  try {
    const snapshot = await db.collection('beatdowns')
      .where('locationId', '==', locationId)
      .get();
    
    const batches = chunkArray(snapshot.docs, BATCH_SIZE);
    
    for (const batch of batches) {
      const writeBatch = db.batch();
      batch.forEach(doc => {
        writeBatch.delete(doc.ref);
      });
      await writeBatch.commit();
    }
  } catch (error) {
    console.error(`Error deleting location ${locationId}:`, error);
    throw error;
  }
}

/**
 * Deletes beatdowns by event ID
 */
async function deleteBeatdownsByEvent(db: admin.firestore.Firestore, eventId: number): Promise<void> {
  try {
    const snapshot = await db.collection('beatdowns')
      .where('eventId', '==', eventId)
      .get();
    
    const batches = chunkArray(snapshot.docs, BATCH_SIZE);
    
    for (const batch of batches) {
      const writeBatch = db.batch();
      batch.forEach(doc => {
        writeBatch.delete(doc.ref);
      });
      await writeBatch.commit();
    }
  } catch (error) {
    console.error(`Error deleting event ${eventId}:`, error);
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
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const webhookData = req.body as MapWebhook;
    const webhookLog = createWebhookLog(webhookData);
    
    // Only process prod channel webhooks
    if (webhookData.channel === 'prod') {
      const db = admin.firestore();
      const { locationId, eventId } = webhookData.data;
      
      if (webhookData.action === 'map.updated') {
        if (eventId) {
          await updateEventBeatdown(db, eventId);
        } else if (locationId) {
          await updateLocationBeatdowns(db, locationId);
        }
        webhookLog.actionedAt = admin.firestore.FieldValue.serverTimestamp();
      } else if (webhookData.action === 'map.deleted') {
        if (locationId) {
          await deleteBeatdownsByLocation(db, locationId);
        } else if (eventId) {
          await deleteBeatdownsByEvent(db, eventId);
        }
        webhookLog.actionedAt = admin.firestore.FieldValue.serverTimestamp();
      }
    }

    // Store in Firestore
    await admin.firestore()
      .collection('webhookLogs')
      .add(webhookLog);

    res.status(200).json({ message: 'Webhook received and processed successfully' });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
