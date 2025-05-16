/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

admin.initializeApp();

// Define interfaces for your API responses
interface Api1Response {
  // Add properties based on first API response
}

interface Api2Response {
  // Add properties based on second API response
}

interface TransformedData {
  // Add properties for your desired output format
}

export const transformData = functions.https.onRequest(async (req, res) => {
  try {
    // Make API calls
    const [response1, response2] = await Promise.all([
      axios.get<Api1Response>('YOUR_FIRST_API_ENDPOINT'),
      axios.get<Api2Response>('YOUR_SECOND_API_ENDPOINT')
    ]);

    // Transform the data
    const transformedData: TransformedData = {
      // Transform the data here based on your requirements
    };

    res.status(200).json(transformedData);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch and transform data' });
  }
});

export const scheduledDataTransform = onSchedule("every 1 hours", async (event) => {
  try {
    logger.info("Starting scheduled data transformation", { structuredData: true });

    // Make API calls
    const [response1, response2] = await Promise.all([
      axios.get<Api1Response>("YOUR_FIRST_API_ENDPOINT"),
      axios.get<Api2Response>("YOUR_SECOND_API_ENDPOINT"),
    ]);

    // Transform the data
    const transformedData: TransformedData = {
      // Transform the data here based on your requirements
    };

    // You can store the transformed data in Firestore or perform other actions
    // For example:
    // await admin.firestore().collection('transformedData').add(transformedData);

    logger.info("Data transformation completed successfully", { structuredData: true });
  } catch (error) {
    logger.error("Error in scheduled data transformation:", error);
    throw error; // This will be logged in Firebase Functions logs
  }
});
