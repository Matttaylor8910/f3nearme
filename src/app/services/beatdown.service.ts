import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Observable } from 'rxjs';
import { Beatdown } from '../pages/nearby/nearby.page';
import { map } from 'rxjs/operators';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

@Injectable({
  providedIn: 'root'
})
export class BeatdownService {
  constructor(private readonly afs: AngularFirestore) {}

  /**
   * Get beatdowns from Firestore
   * If location parameters are provided, filters to beatdowns within the radius
   * Otherwise returns all beatdowns
   * Filters out deleted items
   * @param lat Optional latitude of center point
   * @param lng Optional longitude of center point
   * @param radiusMiles Optional radius in miles to search within
   */
  getNearbyBeatdowns(lat?: number, lng?: number, radiusMiles: number = 100): Observable<Beatdown[]> {
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
   * Get a single beatdown by ID
   * Returns null if beatdown is deleted or doesn't exist
   */
  getBeatdown(id: string): Observable<Beatdown | null> {
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
   * Get all beatdowns at a specific lat long
   * Filters out deleted items
   */
  getBeatdownsByLatLong(lat: number, long: number): Observable<Beatdown[]> {
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
   * Find beatdowns whose ID contains the given partial ID
   * Useful for finding beatdowns when the exact ID doesn't match
   * Filters out deleted items
   * @param partialId Partial ID to search for
   */
  findBeatdownsByPartialId(partialId: string): Observable<Beatdown[]> {
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
   * If lastSyncDate is null, returns all beatdowns (first load)
   * Otherwise, returns only beatdowns updated since lastSyncDate
   * Filters out deleted items
   * @param lastSyncDate Optional date to get beatdowns updated after this date
   */
  getBeatdownsIncremental(lastSyncDate: Date | null): Observable<Beatdown[]> {
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