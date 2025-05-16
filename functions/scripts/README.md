# F3 Beatdown Import Script

This script imports F3 workout location and event data from the F3 Nation API into Firestore.

## Prerequisites

1. Node.js (v14 or later)
2. Firebase Admin SDK credentials
3. Access to the F3 Nation API endpoints

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up Firebase Admin credentials:
   - Place your Firebase Admin SDK service account key JSON file in the `functions/scripts` directory
   - Rename it to `service-account.json`

## Usage

Run the import script:
```bash
npm start
```

The script will:
1. Fetch all locations from the F3 Nation API
2. For each location, fetch detailed information
3. Transform the data into beatdown objects
4. Store the beatdowns in Firestore

## Features

- Retries failed API requests (3 attempts with exponential backoff)
- Processes locations in batches to avoid rate limiting
- Uses Firestore batch writes for efficient data storage
- Provides detailed logging of the import process
- TypeScript for type safety and better development experience

## Error Handling

- Failed API requests are retried up to 3 times
- Individual location failures are logged but don't stop the entire import
- The script will exit with an error code if the initial data fetch fails

## Output

The script will create documents in the `beatdowns` collection in Firestore with the following structure:

```typescript
interface Beatdown {
  dayOfWeek: string;      // e.g., "monday", "wednesday"
  timeString: string;     // e.g., "0515", "0600"
  type: string;          // e.g., "Bootcamp", "Ruck"
  region: string;        // Region name
  website: string;       // Website URL
  notes: string;         // Description
  name: string;          // Location name
  address: string;       // Full address
  lat: number;          // Latitude
  long: number;         // Longitude
}
``` 