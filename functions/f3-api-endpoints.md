# F3 API Endpoints Documentation

This document describes the F3 Nation API endpoints used to fetch workout location and event data.

## Authentication

All API endpoints require authentication using a Bearer token and a client header:

- **Authorization Header:** `Bearer <API_KEY>`
- **Client Header:** `client: f3nearme`

**Note:** You must obtain your API key from the F3 Nation API administrator. Do not commit API keys to version control.

**Base URL:** `https://api.f3nation.com`

## 1. Get All Events

**Endpoint:** `GET /v1/event`

**Description:** Returns a paginated list of all workout events with optional filtering and sorting.

**Headers:**
```
Authorization: Bearer YOUR_API_KEY_HERE
client: f3nearme
```

**Query Parameters (optional):**
- `pageIndex`: number - Page number for pagination
- `pageSize`: number - Number of items per page
- `searchTerm`: string - Search term to filter events
- `statuses`: array - Filter by status (`active`, `inactive`)
- `sorting`: array - Sort configuration
- `regionIds`: array - Filter by region IDs
- `aoIds`: array - Filter by AO (Area of Operations) IDs
- `onlyMine`: boolean - Filter to only user's events

**Response Structure:**

```json
{
  "events": [
    {
      "id": 51940,
      "name": "The Stocks - Run Club",
      "description": "Taking a ~5km run from Bramley Park on various routes.",
      "isActive": true,
      "isPrivate": false,
      "parent": "The Stocks Run Club",
      "locationId": 49961,
      "startDate": "2026-01-16",
      "dayOfWeek": "monday",
      "startTime": "0600",
      "endTime": "0645",
      "email": null,
      "created": "2026-01-16 10:09:38.286497",
      "locationName": "",
      "locationAddress": "Bramley Park",
      "locationAddress2": "",
      "locationCity": "Leeds",
      "locationState": "West Yorkshire",
      "locationZip": "LS13 3PG",
      "parents": [
        {
          "parentId": 51146,
          "parentName": "The Stocks Run Club"
        }
      ],
      "regions": [
        {
          "regionId": 48372,
          "regionName": "Yorkshire"
        }
      ],
      "location": "Bramley Park, Leeds, West Yorkshire",
      "eventTypes": [
        {
          "eventTypeId": 1,
          "eventTypeName": "Bootcamp"
        }
      ]
    }
  ]
}
```

**Note:** The event list endpoint now includes `eventTypes` in the response, so you can get event types directly from the list without fetching individual events.

## 2. Get Event by ID

**Endpoint:** `GET /v1/event/id/{id}`

**Description:** Returns detailed information about a specific event, including event types.

**Response Structure:**

```json
{
  "event": {
    "id": 51940,
    "name": "The Stocks - Run Club",
    "description": "Taking a ~5km run from Bramley Park on various routes.",
    "isActive": true,
    "location": "The Stocks Run Club",
    "locationId": 49961,
    "startDate": "2026-01-16",
    "dayOfWeek": "monday",
    "startTime": "0600",
    "endTime": "0645",
    "email": null,
    "highlight": false,
    "created": "2026-01-16 10:09:38.286497",
    "meta": null,
    "isPrivate": false,
    "aos": [
      {
        "aoId": 51146,
        "aoName": "The Stocks Run Club"
      }
    ],
    "regions": [
      {
        "regionId": 48372,
        "regionName": "Yorkshire"
      }
    ],
    "eventTypes": [
      {
        "eventTypeId": 2,
        "eventTypeName": "Run"
      }
    ]
  }
}
```

## 3. Get All Locations

**Endpoint:** `GET /v1/location`

**Description:** Returns a list of all workout locations.

**Response Structure:**

```json
{
  "locations": [
    {
      "id": 50960,
      "locationName": "Jeni's Ice Cream",
      "regionId": 25124,
      "regionName": "South Charlotte",
      "description": "",
      "isActive": true,
      "latitude": 35.03469207897565,
      "longitude": -80.80631701926951,
      "email": "",
      "addressStreet": "9828 Rea Rd",
      "addressStreet2": null,
      "addressCity": "Charlotte",
      "addressState": "NC",
      "addressZip": "28277",
      "addressCountry": "US",
      "meta": {},
      "created": "2026-01-16 16:53:52.114009"
    }
  ]
}
```

## 4. Get Location by ID

**Endpoint:** `GET /v1/location/id/{id}`

**Description:** Returns detailed information about a specific location.

**Response Structure:**

```json
{
  "location": {
    "id": 49961,
    "locationName": "",
    "description": "Meeting Point: Top of the hill, past children's playground.",
    "isActive": true,
    "created": "2025-05-29 10:46:38.665129",
    "orgId": 48372,
    "regionId": 48372,
    "regionName": "Yorkshire",
    "email": null,
    "latitude": 53.811302,
    "longitude": -1.6371671,
    "addressStreet": "Bramley Park",
    "addressStreet2": "",
    "addressCity": "Leeds",
    "addressState": "West Yorkshire",
    "addressZip": "LS13 3PG",
    "addressCountry": "United Kingdom",
    "meta": null
  }
}
```

## Usage Notes

1. **Event Types:** Event types are now included in the event list endpoint (`/v1/event`), so you can access them directly without fetching individual events. The individual event endpoint (`/v1/event/id/{id}`) also includes event types.

2. **Event Types typically include:**
   - Bootcamp (eventTypeId: 1)
   - Run (eventTypeId: 2)
   - Ruck (eventTypeId: 3)
   - QSource (eventTypeId: 4)
   - Bike (eventTypeId: 7)
   - Wild Card (eventTypeId: 9)

3. **Location Coordinates:** Location latitude and longitude are available in the location endpoints, not in the event endpoints. You must fetch location details separately to get coordinates.

4. **Address Information:** Events include basic address information (`locationAddress`, `locationCity`, `locationState`, `locationZip`, `location`), but for complete address details and coordinates, fetch the location separately.

## Frontend Data Structure

The frontend webapp expects the data to be transformed into a list of days, where each day contains beatdowns (workouts) ordered by distance from the user's location. Here's the expected data structure:

### Beatdown Interface
```typescript
interface Beatdown {
  dayOfWeek: string;      // e.g., "monday", "wednesday"
  timeString: string;     // e.g., "5:00 am - 6:00 am"
  type: string;          // e.g., "Bootcamp", "Ruck"
  region: string;        // Region name from event or location data
  website: string;       // Website URL (currently empty, not provided by API)
  notes: string;         // Description from event data
  name: string;          // Event name
  address: string;       // Full address
  lat: number;          // Latitude from location
  long: number;         // Longitude from location
  milesFromMe: number;  // Calculated distance from user (frontend only)
  eventId: number;      // ID of the event from the API
  locationId: number;   // ID of the location from the API
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

1. Fetch all events using `GET /v1/event` (now includes `eventTypes`)
2. Extract unique `locationId` values from events
3. Fetch location details for each unique location using `GET /v1/location/id/{id}` to get coordinates
4. Transform the API response data into `Beatdown` objects with the following fields:
   - `dayOfWeek`: from event's `dayOfWeek`
   - `timeString`: formatted from event's `startTime` and `endTime` (e.g., "5:00 am - 6:00 am")
   - `type`: from event's `eventTypes[0].eventTypeName` (now included in list endpoint)
   - `region`: from event's `regions[0].regionName` or location's `regionName`
   - `website`: empty string (not provided by API)
   - `notes`: from event's `description`
   - `name`: from event's `name`
   - `address`: from event's `location` string or constructed from address fields
   - `lat`: from location's `latitude`
   - `long`: from location's `longitude`
   - `eventId`: from event's `id`
   - `locationId`: from event's `locationId`
6. Store each `Beatdown` object in Firestore

#### Frontend Responsibilities
The frontend webapp (`nearby.page.ts`) should:

1. Get the user's location using the browser's geolocation API
2. Query Firestore for beatdown documents
3. For each beatdown:
   - Calculate `milesFromMe` using the `distance()` function
   - Group beatdowns by day using the `dayOfWeek` field
   - Sort beatdowns by `milesFromMe` within each day
4. Create `Day` objects:
   - Calculate `daysFromToday` based on the current date
   - Format `dateDisplay` using the `getDateDisplay()` function
   - Set the sorted `beatdowns` array
5. Set the resulting array of `Day` objects to `this.days`

## Sync Script

The sync script (`sync-beatdowns.ts`) imports F3 workout data into Firestore. This script:

1. Fetches all events using `GET /v1/event` (includes `eventTypes`)
2. Extracts unique location IDs from events
3. Fetches location details for each unique location using `GET /v1/location/id/{id}`
4. Transforms the data into `Beatdown` objects (using `eventTypes` from the list endpoint)
5. Stores the beatdowns in Firestore

### Setup

1. Install dependencies:
   ```bash
   cd functions/scripts
   npm install
   ```

2. Add Firebase Admin SDK credentials:
   - Place your service account key JSON file in `functions/scripts/service-account.json`

3. Run the script:
   ```bash
   npm start
   ```

### Features

- Processes events and locations in batches to avoid rate limiting
- Uses `eventTypes` directly from the event list endpoint (no individual fetches needed)
- Uses Firestore batch writes for efficient data storage
- Handles errors gracefully, logging issues without stopping the entire import
- TypeScript for type safety

### Error Handling

- Failed API requests are logged but don't stop the entire import
- Individual event/location failures are logged with warnings
- The script will exit with an error code if critical operations fail

### Output

The script creates documents in the `beatdowns` collection in Firestore with the following structure:

```typescript
interface Beatdown {
  dayOfWeek: string;      // e.g., "monday", "wednesday"
  timeString: string;     // e.g., "5:00 am - 6:00 am"
  type: string;          // e.g., "Bootcamp", "Ruck"
  region: string;        // Region name
  website: string;       // Website URL (currently empty)
  notes: string;         // Description
  name: string;          // Event name
  address: string;       // Full address
  lat: number;          // Latitude
  long: number;         // Longitude
  eventId: number;      // ID of the event from the API
  locationId: number;   // ID of the location from the API
}
```

## API Reference

Full API documentation is available at: https://api.f3nation.com/docs
