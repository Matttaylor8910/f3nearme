/**
 * F3 Map Webhook Handler
 * 
 * This function handles webhook notifications from the F3 map system
 * for location and event updates.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Request, Response } from 'express';

admin.initializeApp();

export const mapWebhook = functions.https.onRequest(async (req: Request, res: Response) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Store whatever payload we receive
    const webhookLog = {
      ...req.body,
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Store in Firestore
    await admin.firestore()
      .collection('webhookLogs')
      .add(webhookLog);

    res.status(200).json({ message: 'Webhook received and logged successfully' });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
