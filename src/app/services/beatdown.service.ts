import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, combineLatest, of } from 'rxjs';
import { Beatdown } from '../pages/nearby/nearby.page';
import { map, filter, switchMap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class BeatdownService {
  constructor(private readonly afs: AngularFirestore) {}

  /**
   * Get beatdowns from Firestore using lat/lng range queries for efficient filtering
   * If location parameters are provided, uses bounding box queries to filter server-side
   * Otherwise returns all beatdowns
   * @param lat Optional latitude of center point
   * @param lng Optional longitude of center point
   * @param radiusMiles Optional radius in miles to search within
   */
  /**
   * Calculate bounding box coordinates for a given center point and radius
   * Uses accurate distance calculations to create a tight bounding box
   * For a circle of radius r, we use a square with side length 2r (radius in each direction)
   * plus a small buffer (0.5 miles) to ensure we capture everything
   */
  private calculateBoundingBox(centerLat: number, centerLng: number, radiusMiles: number): {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } {
    // Convert center latitude to radians
    const centerLatRad = this.toRad(centerLat);
    
    // Use radius + small buffer (0.5 miles) for the bounding box half-dimension
    // This creates a square with side length 2 * (radius + 0.5) miles
    const halfSideMiles = radiusMiles + 0.5;
    
    // Calculate latitude delta (north-south distance)
    // Latitude lines are approximately parallel, so 1 degree ≈ 69 miles
    const latDeltaDegrees = halfSideMiles / 69;
    
    // Calculate longitude delta (east-west distance)
    // Longitude lines converge at the poles, so distance varies by latitude
    // At latitude lat: 1 degree longitude ≈ 69 * cos(lat) miles
    const lngDeltaDegrees = halfSideMiles / (69 * Math.cos(centerLatRad));
    
    // Calculate bounding box
    const minLat = centerLat - latDeltaDegrees;
    const maxLat = centerLat + latDeltaDegrees;
    const minLng = centerLng - lngDeltaDegrees;
    const maxLng = centerLng + lngDeltaDegrees;
    
    return { minLat, maxLat, minLng, maxLng };
  }

  getNearbyBeatdowns(lat?: number, lng?: number, radiusMiles: number = 100): Observable<Beatdown[]> {
    // If no location provided, return all beatdowns (legacy behavior)
    if (lat === undefined || lng === undefined) {
      console.log('[BeatdownService] Loading all beatdowns (no location provided)');
      return this.afs.collection<Beatdown>('beatdowns').snapshotChanges().pipe(
        map(actions => {
          const count = actions.length;
          console.log(`[BeatdownService] Read ${count} beatdowns from Firestore (all documents)`);
          return actions.map(a => {
            const data = a.payload.doc.data() as Beatdown;
            const id = a.payload.doc.id;
            return { ...data, id };
          });
        })
      );
    }

    // Calculate bounding box for the radius
    const bbox = this.calculateBoundingBox(lat, lng, radiusMiles);
    
    console.log(`[BeatdownService] Using lat/lng range query: radius=${radiusMiles} miles, center=(${lat}, ${lng})`);
    console.log(`[BeatdownService] Bounding box: lat [${bbox.minLat.toFixed(4)}, ${bbox.maxLat.toFixed(4)}], lng [${bbox.minLng.toFixed(4)}, ${bbox.maxLng.toFixed(4)}]`);

    // Query Firestore: lat >= minLat AND lat <= maxLat
    // Note: Firestore only allows inequality filters on one field, so we filter lng client-side
    // We query on lat since it's more evenly distributed globally
    return this.afs.collection<Beatdown>('beatdowns', ref =>
      ref.where('lat', '>=', bbox.minLat)
         .where('lat', '<=', bbox.maxLat)
    ).snapshotChanges().pipe(
      map(actions => {
        const beforeLngFilter = actions.length;
        console.log(`[BeatdownService] Read ${beforeLngFilter} documents from Firestore (after lat range filter)`);
        
        // Filter by longitude client-side
        const afterLngFilter = actions.filter(action => {
          const data = action.payload.doc.data() as Beatdown;
          return data.long >= bbox.minLng && data.long <= bbox.maxLng;
        });
        
        console.log(`[BeatdownService] After lng range filter: ${afterLngFilter.length} documents`);
        
        // Convert to Beatdown objects
        const beatdowns = afterLngFilter.map(a => {
          const data = a.payload.doc.data() as Beatdown;
          const id = a.payload.doc.id;
          return { ...data, id };
        });
        
        // Filter client-side for exact radius using Haversine formula
        const filtered = beatdowns.filter(bd => 
          this.isWithinRadius(bd.lat, bd.long, lat, lng, radiusMiles)
        );
        
        console.log(`[BeatdownService] After client-side radius filtering: ${filtered.length} beatdowns within ${radiusMiles} miles`);
        
        return filtered;
      })
    );
  }

  /**
   * Get cities from the cities collection within a radius
   * @param lat Latitude of center point
   * @param lng Longitude of center point
   * @param radiusMiles Radius in miles to search within
   */
  getCities(lat?: number, lng?: number, radiusMiles: number = 300): Observable<Array<{city: string; regions: string[]; lat: number; long: number}>> {
    // If no location provided, load all cities (for search functionality)
    if (lat === undefined || lng === undefined) {
      console.log('[BeatdownService] Loading all cities from cities collection (no location provided)');
      return this.afs.collection('cities').snapshotChanges().pipe(
        map(actions => {
          const count = actions.length;
          console.log(`[BeatdownService] Read ${count} cities from Firestore (all cities)`);
          return actions.map(a => {
            const data = a.payload.doc.data();
            return {
              city: data['city'],
              regions: data['regions'] || [],
              lat: data['lat'],
              long: data['long']
            };
          });
        })
      );
    }

    // Calculate bounding box for cities
    const bbox = this.calculateBoundingBox(lat, lng, radiusMiles);
    
    console.log(`[BeatdownService] Loading cities within ${radiusMiles} miles: center=(${lat}, ${lng})`);
    console.log(`[BeatdownService] Cities bounding box: lat [${bbox.minLat.toFixed(4)}, ${bbox.maxLat.toFixed(4)}], lng [${bbox.minLng.toFixed(4)}, ${bbox.maxLng.toFixed(4)}]`);

    // Query cities by lat range, filter lng client-side
    return this.afs.collection('cities', ref =>
      ref.where('lat', '>=', bbox.minLat)
         .where('lat', '<=', bbox.maxLat)
    ).snapshotChanges().pipe(
      map(actions => {
        const beforeLngFilter = actions.length;
        console.log(`[BeatdownService] Read ${beforeLngFilter} cities from Firestore (after lat range filter)`);
        
        // Filter by longitude client-side
        const afterLngFilter = actions.filter(action => {
          const data = action.payload.doc.data();
          const cityLat = data['lat'];
          const cityLng = data['long'];
          return cityLng >= bbox.minLng && cityLng <= bbox.maxLng;
        });
        
        console.log(`[BeatdownService] After lng range filter: ${afterLngFilter.length} cities`);
        
        return afterLngFilter.map(a => {
          const data = a.payload.doc.data();
          return {
            city: data['city'],
            regions: data['regions'] || [],
            lat: data['lat'],
            long: data['long']
          };
        });
      })
    );
  }

  /**
   * Get a single beatdown by ID
   */
  getBeatdown(id: string): Observable<Beatdown> {
    return this.afs.doc<Beatdown>(`beatdowns/${id}`).snapshotChanges().pipe(
      map(action => {
        const data = action.payload.data() as Beatdown;
        return { ...data, id: action.payload.id };
      })
    );
  }

  /**
   * Get all beatdowns at a specific lat long
   */
  getBeatdownsByLatLong(lat: number, long: number): Observable<Beatdown[]> {
    return this.afs.collection<Beatdown>('beatdowns', ref => 
      ref.where('lat', '==', lat).where('long', '==', long)
    ).snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as Beatdown;
        const id = a.payload.doc.id;
        return { ...data, id };
      }))
    );
  }

  /**
   * Calculate if a point is within a radius of another point
   * Using the Haversine formula
   */
  private isWithinRadius(lat1: number, lon1: number, lat2: number, lon2: number, radiusMiles: number): boolean {
    const R = 3958.8; // Earth's radius in miles
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    return distance <= radiusMiles;
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
} 