# F3 API Endpoints Documentation

This document describes the two main endpoints used to fetch F3 workout location and event data.

## 1. Get Map Event and Location Data

**Endpoint:** `https://map.f3nation.com/api/trpc/location.getMapEventAndLocationData`

**Method:** GET

**Description:** Returns a list of all F3 workout locations with their basic information and scheduled events.

### Response Structure

```json
{
  "result": {
    "data": {
      "json": [
        [
          locationId,        // number
          locationName,      // string
          logoUrl,          // string (can be empty)
          latitude,         // number
          longitude,        // number
          fullAddress,      // string
          [                 // array of events
            [
              eventId,      // number
              eventName,    // string
              dayOfWeek,    // string (e.g., "monday", "wednesday")
              startTime,    // string (e.g., "0515")
              [             // array of event types
                {
                  "id": number,
                  "name": string  // e.g., "Bootcamp", "Ruck"
                }
              ]
            ]
          ]
        ]
      ]
    }
  }
}
```

## 2. Get Location Workout Data

**Endpoint:** `https://map.f3nation.com/api/trpc/location.getLocationWorkoutData`

**Method:** GET

**Query Parameters:**
- `input`: JSON object containing `locationId`
  ```json
  {
    "json": {
      "locationId": number
    }
  }
  ```

**Description:** Returns detailed information about a specific F3 workout location, including all events, contact information, and metadata.

### Response Structure

```json
{
  "result": {
    "data": {
      "json": {
        "location": {
          "id": number,
          "name": string,
          "description": string | null,
          "lat": number,
          "lon": number,
          "orgId": number,
          "locationName": string,
          "locationMeta": {
            "latLonKey": string,
            "address1": string,
            "address2": string,
            "city": string,
            "state": string,
            "postalCode": string,
            "country": string,
            "mapSeed": boolean
          },
          "locationAddress": string,
          "locationAddress2": string,
          "locationCity": string,
          "locationState": string,
          "locationZip": string,
          "locationCountry": string,
          "isActive": boolean,
          "created": string,
          "updated": string,
          "locationDescription": string | null,
          "parentId": number,
          "parentLogo": string,
          "parentName": string,
          "parentWebsite": string,
          "regionId": number,
          "regionName": string,
          "regionLogo": string | null,
          "regionWebsite": string,
          "regionType": string,
          "fullAddress": string,
          "events": [
            {
              "id": number,
              "name": string,
              "description": string,
              "dayOfWeek": string,
              "startTime": string,
              "endTime": string,
              "eventTypes": [
                {
                  "id": number,
                  "name": string
                }
              ],
              "aoId": number,
              "aoLogo": string,
              "aoWebsite": string,
              "aoName": string
            }
          ]
        }
      }
    }
  }
}
```

## Usage Notes

1. The first endpoint (`getMapEventAndLocationData`) should be used to get an overview of all locations and their basic event information.
2. The second endpoint (`getLocationWorkoutData`) should be used to get detailed information about a specific location using its `locationId`.
3. Event types typically include:
   - Bootcamp (id: 1)
   - Run (id: 2)
   - Ruck (id: 3)
   - QSource (id: 4)
   - Bike (id: 7)
   - Wild Card (id: 9)

## Frontend Data Structure

The frontend webapp expects the data to be transformed into a list of days, where each day contains beatdowns (workouts) ordered by distance from the user's location. Here's the expected data structure:

### Beatdown Interface
```typescript
interface Beatdown {
  dayOfWeek: string;      // e.g., "monday", "wednesday"
  timeString: string;     // e.g., "0515", "0600"
  type: string;          // e.g., "Bootcamp", "Ruck"
  region: string;        // Region name from location data
  website: string;       // Website URL from location data
  notes: string;         // Description from event data
  name: string;          // Location name
  address: string;       // Full address
  lat: number;          // Latitude
  long: number;         // Longitude
  milesFromMe: number;  // Calculated distance from user
}
```

### Day Interface
```typescript
interface Day {
  daysFromToday: number;  // 0 for today, 1 for tomorrow, etc.
  dateDisplay: string;    // "Today", "Tomorrow", "Wednesday", "Monday July 12", etc.
  beatdowns: Beatdown[];  // Array of beatdowns ordered by distance from user
}
```

### Data Transformation Notes

#### Backend Responsibilities
The backend service should:

1. Hit the `getMapEventAndLocationData` endpoint to get all locations
2. For each location, call `getLocationWorkoutData` to get detailed information
3. Transform the API response data into `Beatdown` objects with the following fields:
   - `dayOfWeek`: from event's `dayOfWeek`
   - `timeString`: from event's `startTime`
   - `type`: from event's `eventTypes[0].name`
   - `region`: from location's `regionName`
   - `website`: from location's `parentWebsite`
   - `notes`: from event's `description`
   - `name`: from location's `name`
   - `address`: from location's `fullAddress`
   - `lat`: from location's `lat`
   - `long`: from location's `lon`
4. Store each `Beatdown` object in Firestore, using the location and event data as the document fields

#### Frontend Responsibilities
The frontend webapp (`nearby.page.ts`) should:

1. Get the user's location using the browser's geolocation API
2. Query Firestore for all beatdown documents where the location is within 100 miles of the user
3. For each beatdown:
   - Calculate `milesFromMe` using the `distance()` function (as shown in `nearby.page.ts`)
   - Group beatdowns by day using the `dayOfWeek` field
   - Sort beatdowns by `milesFromMe` within each day
4. Create `Day` objects:
   - Calculate `daysFromToday` based on the current date
   - Format `dateDisplay` using the `getDateDisplay()` function
   - Set the sorted `beatdowns` array
5. Set the resulting array of `Day` objects to `this.days`

The frontend code in `nearby.page.ts` already implements the necessary functions for:
- Calculating distances (`distance()`)
- Formatting dates (`getDateDisplay()`)
- Grouping and sorting beatdowns
- Handling user location
- Managing the UI state 

## Import Script

A Node.js script (`import-beatdowns.ts`) is provided to import F3 workout data into Firestore. This script:

1. Fetches all locations using `getMapEventAndLocationData`
2. For each location, fetches detailed data using `getLocationWorkoutData`
3. Transforms the data into `Beatdown` objects
4. Stores the beatdowns in Firestore

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Add Firebase Admin SDK credentials:
   - Place your service account key JSON file in `functions/scripts/service-account.json`

3. Run the script:
   ```bash
   npm start
   ```

### Features

- Processes locations in batches (10 at a time) to avoid rate limiting
- Retries failed API requests (3 attempts with exponential backoff)
- Uses Firestore batch writes for efficient data storage
- Handles errors gracefully, logging issues without stopping the entire import
- TypeScript for type safety

### Error Handling

- Failed API requests are retried up to 3 times
- Individual location failures are logged but don't stop the entire import
- The script will exit with an error code if the initial data fetch fails

### Output

The script creates documents in the `beatdowns` collection in Firestore with the following structure:

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