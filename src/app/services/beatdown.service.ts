import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable, from, of } from 'rxjs';
import { Beatdown } from '../pages/nearby/nearby.page';
import { map, catchError } from 'rxjs/operators';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class BeatdownService {
  private dataUrl = environment.dataUrl;
  private useJsonCache = false; // Toggle to fallback to Firestore if needed

  constructor(private readonly afs: AngularFirestore) {}

  /**
   * Fetch JSON data from Cloud Storage
   */
  private fetchJsonData<T>(path: string): Observable<T> {
    const url = `${this.dataUrl}/${path}`;
    return from(fetch(url).then(res => {
      if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
      }
      return res.json() as Promise<T>;
    })).pipe(
      catchError(error => {
        console.error(`Error fetching JSON from ${url}:`, error);
        throw error;
      })
    );
  }

  /**
   * Get beatdowns from JSON cache or Firestore fallback
   * If location parameters are provided, filters to beatdowns within the radius
   * Otherwise returns all beatdowns
   * Filters out deleted items
   * @param lat Optional latitude of center point
   * @param lng Optional longitude of center point
   * @param radiusMiles Optional radius in miles to search within
   */
  getNearbyBeatdowns(lat?: number, lng?: number, radiusMiles: number = 100): Observable<Beatdown[]> {
    if (this.useJsonCache) {
      return this.fetchJsonData<Array<Beatdown & { id: string }>>('all.json').pipe(
        map(beatdowns => {
          // Filter out deleted items (shouldn't be in JSON, but just in case)
          const activeBeatdowns = beatdowns.filter(bd => !bd.deleted);
          
          if (lat === undefined || lng === undefined) {
            return activeBeatdowns;
          }
          return activeBeatdowns.filter(bd => this.isWithinRadius(bd.lat, bd.long, lat, lng, radiusMiles));
        }),
        catchError(error => {
          console.warn('Failed to fetch from JSON cache, falling back to Firestore:', error);
          return this.getNearbyBeatdownsFromFirestore(lat, lng, radiusMiles);
        })
      );
    }
    return this.getNearbyBeatdownsFromFirestore(lat, lng, radiusMiles);
  }

  /**
   * Get beatdowns from Firestore (fallback method)
   */
  private getNearbyBeatdownsFromFirestore(lat?: number, lng?: number, radiusMiles: number = 100): Observable<Beatdown[]> {
    return this.afs.collection<Beatdown>('beatdowns').snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as Beatdown;
        const id = a.payload.doc.id;
        return { ...data, id };
      })),
      map(beatdowns => {
        // Filter out deleted items
        const activeBeatdowns = beatdowns.filter(bd => !bd.deleted);
        
        if (lat === undefined || lng === undefined) {
          return activeBeatdowns;
        }
        return activeBeatdowns.filter(bd => this.isWithinRadius(bd.lat, bd.long, lat, lng, radiusMiles));
      })
    );
  }

  /**
   * Get a single beatdown by ID from JSON cache or Firestore fallback
   * Returns null if beatdown is deleted or doesn't exist
   */
  getBeatdown(id: string): Observable<Beatdown | null> {
    if (this.useJsonCache) {
      return this.fetchJsonData<Array<Beatdown & { id: string }>>('all.json').pipe(
        map(beatdowns => {
          const beatdown = beatdowns.find(bd => bd.id === id);
          if (!beatdown || beatdown.deleted) {
            return null;
          }
          return beatdown;
        }),
        catchError(error => {
          console.warn('Failed to fetch from JSON cache, falling back to Firestore:', error);
          return this.getBeatdownFromFirestore(id);
        })
      );
    }
    return this.getBeatdownFromFirestore(id);
  }

  /**
   * Get a single beatdown by ID from Firestore (fallback method)
   */
  private getBeatdownFromFirestore(id: string): Observable<Beatdown | null> {
    return this.afs.doc<Beatdown>(`beatdowns/${id}`).snapshotChanges().pipe(
      map(action => {
        if (!action.payload.exists) {
          return null;
        }
        const data = action.payload.data() as Beatdown;
        // Return null if deleted
        if (data.deleted) {
          return null;
        }
        return { ...data, id: action.payload.id };
      })
    );
  }

  /**
   * Get all beatdowns at a specific lat long from JSON cache or Firestore fallback
   * Filters out deleted items
   */
  getBeatdownsByLatLong(lat: number, long: number): Observable<Beatdown[]> {
    if (this.useJsonCache) {
      return this.fetchJsonData<Array<Beatdown & { id: string }>>('all.json').pipe(
        map(beatdowns => {
          return beatdowns.filter(bd => 
            !bd.deleted && 
            bd.lat === lat && 
            bd.long === long
          );
        }),
        catchError(error => {
          console.warn('Failed to fetch from JSON cache, falling back to Firestore:', error);
          return this.getBeatdownsByLatLongFromFirestore(lat, long);
        })
      );
    }
    return this.getBeatdownsByLatLongFromFirestore(lat, long);
  }

  /**
   * Get all beatdowns at a specific lat long from Firestore (fallback method)
   */
  private getBeatdownsByLatLongFromFirestore(lat: number, long: number): Observable<Beatdown[]> {
    return this.afs.collection<Beatdown>('beatdowns', ref => 
      ref.where('lat', '==', lat).where('long', '==', long)
    ).snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as Beatdown;
        const id = a.payload.doc.id;
        return { ...data, id };
      })),
      map(beatdowns => beatdowns.filter(bd => !bd.deleted))
    );
  }

  /**
   * Find beatdowns whose ID contains the given partial ID from JSON cache or Firestore fallback
   * Useful for finding beatdowns when the exact ID doesn't match
   * Filters out deleted items
   * @param partialId Partial ID to search for
   */
  findBeatdownsByPartialId(partialId: string): Observable<Beatdown[]> {
    if (this.useJsonCache) {
      return this.fetchJsonData<Array<Beatdown & { id: string }>>('all.json').pipe(
        map(beatdowns => {
          // Filter out deleted items and find IDs that contain the partial ID
          return beatdowns.filter(bd => !bd.deleted && bd.id.includes(partialId));
        }),
        catchError(error => {
          console.warn('Failed to fetch from JSON cache, falling back to Firestore:', error);
          return this.findBeatdownsByPartialIdFromFirestore(partialId);
        })
      );
    }
    return this.findBeatdownsByPartialIdFromFirestore(partialId);
  }

  /**
   * Find beatdowns whose ID contains the given partial ID from Firestore (fallback method)
   */
  private findBeatdownsByPartialIdFromFirestore(partialId: string): Observable<Beatdown[]> {
    return this.afs.collection<Beatdown>('beatdowns').snapshotChanges().pipe(
      map(actions => actions.map(a => {
        const data = a.payload.doc.data() as Beatdown;
        const id = a.payload.doc.id;
        return { ...data, id };
      })),
      map(beatdowns => {
        // Filter out deleted items and find IDs that contain the partial ID
        return beatdowns.filter(bd => !bd.deleted && bd.id.includes(partialId));
      })
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

  /**
   * Get beatdowns incrementally based on lastSyncDate
   * If lastSyncDate is null, returns all beatdowns (first load) from JSON cache
   * Otherwise, falls back to Firestore for incremental updates
   * Filters out deleted items
   * @param lastSyncDate Optional date to get beatdowns updated after this date
   */
  getBeatdownsIncremental(lastSyncDate: Date | null): Observable<Beatdown[]> {
    if (lastSyncDate === null) {
      // First load: get all beatdowns from JSON cache
      if (this.useJsonCache) {
        return this.fetchJsonData<Array<Beatdown & { id: string }>>('all.json').pipe(
          map(beatdowns => beatdowns.filter(bd => !bd.deleted)),
          catchError(error => {
            console.warn('Failed to fetch from JSON cache, falling back to Firestore:', error);
            return this.getBeatdownsIncrementalFromFirestore(null);
          })
        );
      }
    }
    // Incremental load: must use Firestore for timestamp queries
    return this.getBeatdownsIncrementalFromFirestore(lastSyncDate);
  }

  /**
   * Get beatdowns incrementally from Firestore (fallback method)
   */
  private getBeatdownsIncrementalFromFirestore(lastSyncDate: Date | null): Observable<Beatdown[]> {
    if (lastSyncDate === null) {
      // First load: get all beatdowns, filter out deleted
      return this.afs.collection<Beatdown>('beatdowns').snapshotChanges().pipe(
        map(actions => actions.map(a => {
          const data = a.payload.doc.data() as Beatdown;
          const id = a.payload.doc.id;
          return { ...data, id };
        })),
        map(beatdowns => beatdowns.filter(bd => !bd.deleted))
      );
    } else {
      // Incremental load: get beatdowns updated since lastSyncDate
      // Convert Date to Firestore Timestamp for query
      const timestamp = firebase.firestore.Timestamp.fromDate(lastSyncDate);
      
      return this.afs.collection<Beatdown>('beatdowns', ref => 
        ref.where('lastUpdated', '>', timestamp)
      ).snapshotChanges().pipe(
        map(actions => actions.map(a => {
          const data = a.payload.doc.data() as Beatdown;
          const id = a.payload.doc.id;
          return { ...data, id };
        })),
        map(beatdowns => beatdowns.filter(bd => !bd.deleted))
      );
    }
  }
} 