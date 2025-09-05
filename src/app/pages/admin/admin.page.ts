import { Component, OnInit } from '@angular/core';
import { AngularFireFunctions } from '@angular/fire/compat/functions';

interface SyncResult {
  locationId: number;
  success: boolean;
  error?: string;
  duration?: number;
}

interface SyncProgress {
  total: number;
  completed: number;
  errors: number;
  currentLocationId?: number;
}

@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
})

export class AdminPage implements OnInit {
  webhookAfterDate: string = '';
  webhookDryRun: boolean = false;
  webhookLoading: boolean = false;
  webhookResults: any = null;
  webhookError: boolean = false;

  locationIds: string = '';
  locationDryRun: boolean = false;
  locationLoading: boolean = false;
  locationResults: any = null;
  locationError: boolean = false;

  // Bulk sync properties
  allLocationIds: number[] | null = null;
  gettingLocationIds: boolean = false;
  syncStarted: boolean = false;
  syncProgress: SyncProgress = { total: 0, completed: 0, errors: 0 };
  bulkSyncResults: SyncResult[] = [];

  constructor(private fns: AngularFireFunctions) { }

  ngOnInit() {
    this.setRecentDate(1);
  }

  setRecentDate(days: number) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    this.webhookAfterDate = date.toISOString();
  }

  async rerunWebhooks() {
    this.webhookLoading = true;
    this.webhookError = false;
    this.webhookResults = null;

    try {
      const callable = this.fns.httpsCallable('adminRerunWebhooks');
      const payload = {
        afterDate: this.webhookAfterDate,
        dryRun: this.webhookDryRun
      };

      const response = await callable(payload).toPromise();
      this.webhookResults = response;
      this.webhookError = false;
    } catch (error) {
      this.webhookResults = error;
      this.webhookError = true;
    } finally {
      this.webhookLoading = false;
    }
  }

  async refreshSpecificLocations() {
    if (!this.locationIds?.trim()) {
      return;
    }

    this.locationLoading = true;
    this.locationError = false;
    this.locationResults = null;

    try {
      const locationIds = this.locationIds.split(',')
        .map(id => parseInt(id.trim()))
        .filter(id => !isNaN(id));

      if (locationIds.length === 0) {
        throw new Error('No valid location IDs provided');
      }

      const callable = this.fns.httpsCallable('adminRefreshSpecificLocations');
      const payload = {
        locationIds,
        dryRun: this.locationDryRun
      };

      const response = await callable(payload).toPromise();
      this.locationResults = response;
      this.locationError = false;
    } catch (error) {
      this.locationResults = error;
      this.locationError = true;
    } finally {
      this.locationLoading = false;
    }
  }

  async getAllLocationIds() {
    this.gettingLocationIds = true;
    try {
      const callable = this.fns.httpsCallable('adminGetAllLocationIds');
      const response: any = await callable({}).toPromise();
      this.allLocationIds = response.locationIds;
    } catch (error) {
      console.error('Error getting location IDs:', error);
      // Reset state on error
      this.allLocationIds = null;
    } finally {
      this.gettingLocationIds = false;
    }
  }

  startBulkSync() {
    if (!this.allLocationIds) return;
    
    this.syncStarted = true;
    this.syncProgress = {
      total: this.allLocationIds.length,
      completed: 0,
      errors: 0
    };
    this.bulkSyncResults = [];
    
    this.processBulkSync();
  }

  async processBulkSync() {
    if (!this.allLocationIds) return;
    
    // Process locations with concurrency limit
    const CONCURRENCY_LIMIT = 5;
    const locationIds = [...this.allLocationIds];
    
    while (locationIds.length > 0) {
      // Process batch of locations
      const batch = locationIds.splice(0, CONCURRENCY_LIMIT);
      const batchPromises = batch.map(locationId => this.syncSingleLocation(locationId));
      
      const batchResults = await Promise.all(batchPromises);
      this.bulkSyncResults.push(...batchResults);
      
      // Update progress
      this.syncProgress.completed += batchResults.length;
      this.syncProgress.errors += batchResults.filter(r => !r.success).length;
      this.syncProgress.currentLocationId = undefined;
      
      // Small delay between batches to be nice to the API
      if (locationIds.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async syncSingleLocation(locationId: number): Promise<SyncResult> {
    const startTime = Date.now();
    this.syncProgress.currentLocationId = locationId;
    
    try {
      const callable = this.fns.httpsCallable('adminUpdateSingleLocation');
      await callable({ locationId }).toPromise();
      return {
        locationId,
        success: true,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        locationId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      };
    }
  }

  resetBulkSync() {
    this.allLocationIds = null;
    this.syncStarted = false;
    this.syncProgress = { total: 0, completed: 0, errors: 0 };
    this.bulkSyncResults = [];
  }

  get successfulSyncs() {
    return this.bulkSyncResults.filter(r => r.success).length;
  }

  get failedSyncs() {
    return this.bulkSyncResults.filter(r => !r.success).length;
  }
}
