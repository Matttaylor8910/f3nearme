import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, combineLatest, of } from 'rxjs';
import { Beatdown } from '../pages/nearby/nearby.page';
import { map, filter, switchMap } from 'rxjs/operators';
// @ts-ignore - ngeohash doesn't have type definitions
import * as ngeohash from 'ngeohash';

@Injectable({
  providedIn: 'root'
})
export class BeatdownService {
  constructor(private readonly afs: AngularFirestore) {}

  /**
   * Get beatdowns from Firestore using geohash queries for efficient filtering
   * If location parameters are provided, uses geohash queries to filter server-side
   * Otherwise returns all beatdowns
   * @param lat Optional latitude of center point
   * @param lng Optional longitude of center point
   * @param radiusMiles Optional radius in miles to search within
   */
  getNearbyBeatdowns(lat?: number, lng?: number, radiusMiles: number = 100): Observable<Beatdown[]> {
    // If no location provided, return all beatdowns (legacy behavior)
    if (lat === undefined || lng === undefined) {
      return this.afs.collection<Beatdown>('beatdowns').snapshotChanges().pipe(
        map(actions => actions.map(a => {
          const data = a.payload.doc.data() as Beatdown;
          const id = a.payload.doc.id;
          return { ...data, id };
        }))
      );
    }

    // Determine geohash precision based on radius
    let geohashPrecision: number;
    let geohashField: 'geohash_4' | 'geohash_5' | 'geohash_6';
    
    if (radiusMiles >= 50) {
      geohashPrecision = 4; // ~150km coverage
      geohashField = 'geohash_4';
    } else if (radiusMiles >= 10) {
      geohashPrecision = 5; // ~20km coverage
      geohashField = 'geohash_5';
    } else {
      geohashPrecision = 6; // ~5km coverage
      geohashField = 'geohash_6';
    }

    // Calculate center geohash
    const centerGeohash = ngeohash.encode(lat, lng, geohashPrecision);
    
    // Get neighboring geohash prefixes (9 total: center + 8 neighbors)
    const neighbors = ngeohash.neighbors(centerGeohash);
    const geohashPrefixes = [centerGeohash, ...neighbors];

    // Query Firestore for each geohash prefix
    // Since geohash_4/5/6 are stored as exact prefixes, we query for exact matches
    // Use range query: prefix <= geohash < prefix + next character in base32
    const queries = geohashPrefixes.map(prefix => {
      // Get the next character after the prefix for upper bound
      // Base32 characters: 0123456789bcdefghjkmnpqrstuvwxyz
      // We'll use prefix + 'z' + 1 (which is '{') as upper bound, but filter client-side
      // Actually, simpler: query where field equals prefix (exact match)
      return this.afs.collection<Beatdown>('beatdowns', ref =>
        ref.where(geohashField, '==', prefix)
      ).snapshotChanges().pipe(
        map(actions => actions.map(a => {
          const data = a.payload.doc.data() as Beatdown;
          const id = a.payload.doc.id;
          return { ...data, id };
        }))
      );
    });

    // Combine all queries and merge results
    return combineLatest(queries).pipe(
      map(results => {
        // Flatten and deduplicate by document ID
        const beatdownMap = new Map<string, Beatdown>();
        results.forEach(beatdowns => {
          beatdowns.forEach(bd => {
            if (!beatdownMap.has(bd.id)) {
              beatdownMap.set(bd.id, bd);
            }
          });
        });

        const allBeatdowns = Array.from(beatdownMap.values());
        
        // Filter client-side for exact radius using Haversine formula
        return allBeatdowns.filter(bd => 
          this.isWithinRadius(bd.lat, bd.long, lat, lng, radiusMiles)
        );
      })
    );
  }

  /**
   * Get all cities from the cities collection
   */
  getCities(): Observable<Array<{city: string; regions: string[]; lat: number; long: number}>> {
    return this.afs.collection('cities').snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data();
        return {
          city: data['city'],
          regions: data['regions'] || [],
          lat: data['lat'],
          long: data['long']
        };
      }))
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