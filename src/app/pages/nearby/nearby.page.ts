import {Component} from '@angular/core';
import {ActionSheetController, Platform} from '@ionic/angular';
import {BeatdownService} from '../../services/beatdown.service';

export interface Beatdown {
  id: string;
  dayOfWeek: string;
  timeString: string;
  type: string;
  region: string;
  website: string;
  notes: string;
  name: string;
  address: string;
  lat: number;
  long: number;
  milesFromMe: number;
}

interface Day {
  daysFromToday: number;  // 0 for today, 1 tomorrow, etc
  dateDisplay: string;    // Today, Tomorrow, Wednesday, Monday July 12, etc
  beatdowns: Beatdown[];  // the beatdowns ordered by distance from you
}

interface Coords {
  latitude: number;
  longitude: number;
}

interface IPLocation {
  ip: string;
  city: string;
  region: string;
  country_name: string;
  country_code: string;
  postal: string;
  latitude: number;
  longitude: number;
  timezone: string;
  org: string;
}

interface RegionCity {
  city: string;
  regions: string[];
  lat: number;
  long: number;
  distance?: number;  // Distance from current location
}

const MILES_OPTIONS = [10, 20, 30, 50, 100];
const DEFAULT_LIMIT = 30;

const MIN_FILTER_TEXT_LENGTH = 3;

const DAYS = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
];

const STATE_MAP = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
  'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
  'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
  'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
  'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
  'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
  'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
  'district of columbia': 'DC'
};

@Component({
  selector: 'app-nearby',
  templateUrl: 'nearby.page.html',
  styleUrls: ['nearby.page.scss']
})
export class NearbyPage {
  allBDs: Beatdown[];
  nearbyMap = new Map<string, Beatdown[]>;
  ipLocation: IPLocation | null = null;

  days: Day[];
  limit = this.loadLimit();
  showRegion = false;
  filterText: string;

  myLocation: Coords | null = null;
  selectedLocation: Coords | null = null;
  locationFailure = false;
  locationHelpLink = this.getLocationHelpLink();

  // Region selection
  showRegionSelector = false;
  cities: RegionCity[] = [];
  filteredCities: RegionCity[] = [];
  citySearchText = '';

  selectedCity: RegionCity | null = null;
  showRegionModal = false;
  showNearbyCities = false;

  constructor(
      private readonly beatdownService: BeatdownService,
      private readonly actionSheetController: ActionSheetController,
      private readonly platform: Platform,
  ) {}

  ngOnInit() {
    this.loadFromCache();
    this.setMyLocation();
    this.loadBeatdowns();
  }

  get filterTooShort(): boolean {
    return this.filterText && this.filterText?.length < MIN_FILTER_TEXT_LENGTH;
  }

  get emptyText(): string {
    if (this.filterTooShort) {
      return `Your filter needs to be at least ${
          MIN_FILTER_TEXT_LENGTH} characters`;
    }

    return this.filterText ?
        `No F3 workouts matching "${this.filterText}"` :
        `No F3 workouts within ${this.limit} miles of your location`;
  }

  /**
   * Load the beatdowns from Firestore
   * Uses geohash queries if location is available, otherwise loads all (legacy)
   */
  loadBeatdowns() {
    // If we have a selected location, use geohash queries for efficiency
    if (this.selectedLocation) {
      this.beatdownService.getNearbyBeatdowns(
        this.selectedLocation.latitude,
        this.selectedLocation.longitude,
        this.limit
      ).subscribe({
        next: (beatdowns) => {
          this.allBDs = beatdowns;
          this.saveToCache();
          this.loadCities();
          this.setNearbyBeatdowns();
        },
        error: (error) => {
          console.error('Error loading beatdowns:', error);
          this.loadFromCache();
        }
      });
    } else {
      // No location yet, load all (will be filtered when location is set)
      this.beatdownService.getNearbyBeatdowns().subscribe({
        next: (beatdowns) => {
          this.allBDs = beatdowns;
          this.saveToCache();
          this.loadCities();
          this.setNearbyBeatdowns();
        },
        error: (error) => {
          console.error('Error loading beatdowns:', error);
          this.loadFromCache();
        }
      });
    }
  }

  /**
   * Load cities from the cities collection
   */
  loadCities() {
    this.beatdownService.getCities().subscribe({
      next: (citiesData) => {
        const userLoc = this.userLocation;
        this.cities = citiesData.map(cityData => ({
          city: cityData.city,
          regions: cityData.regions,
          lat: cityData.lat,
          long: cityData.long,
          distance: userLoc ? this.distance(
            cityData.lat,
            cityData.long,
            userLoc.latitude,
            userLoc.longitude
          ) : undefined,
        })).sort((a, b) => {
          // Sort by distance, fall back to city name
          return (a.distance || 0) - (b.distance || 0) || a.city.localeCompare(b.city);
        });
        this.filteredCities = [...this.cities];
      },
      error: (error) => {
        console.error('Error loading cities:', error);
        // Fallback to extracting from beatdowns if cities collection fails
        this.extractCities();
      }
    });
  }

  /**
   * Try to get the user's location
   */
  setMyLocation() {
    try {
      if (navigator.geolocation) {
        const options = {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0
        };
        
        navigator.geolocation.getCurrentPosition(
          this.onGeolocationSuccess.bind(this),
          this.onGeolocationFailure.bind(this),
          options
        );
      } else {
        this.onGeolocationFailure();
      }
    } catch (error) {
      console.error('Error getting location:', error);
      this.onGeolocationFailure();
    }
  }

  /**
   * Fetch IP-based location as a fallback
   */
  private async fetchIPLocation() {
    try {
      const response = await fetch('https://ipapi.co/json/');
      this.ipLocation = await response.json();
      
      // Only set location if we don't have one yet
      if (!this.selectedLocation) {
        this.selectedLocation = {
          latitude: this.ipLocation.latitude,
          longitude: this.ipLocation.longitude
        };
        // Reload beatdowns with geohash queries now that we have location
        this.loadBeatdowns();
      }
    } catch (error) {
      console.error('Error getting IP location:', error);
    }
  }

  /**
   * Handle successfully getting the user's location
   */
  onGeolocationSuccess(position: GeolocationPosition) {
    const {latitude, longitude} = position.coords;
    this.myLocation = {latitude, longitude};
    this.selectedLocation = {latitude, longitude};  // Set selected location to match my location
    this.locationFailure = false;
    setTimeout(() => {
      // Reload beatdowns with geohash queries now that we have location
      this.loadBeatdowns();
    });
  }

  /**
   * Handle being unable to load the user's location
   */
  onGeolocationFailure(failure?: GeolocationPositionError) {
    if (failure) {
      switch (failure.code) {
        case 1: // PERMISSION_DENIED
          break;
        case 2: // POSITION_UNAVAILABLE
          break;
        case 3: // TIMEOUT
          break;
      }
    }
    this.locationFailure = true;
    this.myLocation = null;
    this.selectedLocation = null;
    this.fetchIPLocation();
  }

  /**
   * Filter down to the nearby beatdowns and set the data in the app
   */
  setNearbyBeatdowns() {
    // no-op if we don't have beatdowns or a selected location
    if (!this.selectedLocation || !this.allBDs) return;

    // don't try to build up the days with too small of a filter text for
    // performance reasons
    if (this.filterTooShort) {
      this.days = [];
      return;
    }

    const regionSet = new Set<string>();
    this.nearbyMap = new Map<string, Beatdown[]>();
    this.days = [];

    // filter down to the bds within N miles (as the crow flies)
    const nearby = this.allBDs.filter(bd => {
      const dist = this.distance(
          bd.lat,
          bd.long,
          this.selectedLocation.latitude,
          this.selectedLocation.longitude,
      );

      // Only set milesFromMe if we're using my location
      if (this.userLocation) {
        bd.milesFromMe = this.distance(
          bd.lat,
          bd.long,
          this.userLocation.latitude,
          this.userLocation.longitude,
        );
      }

      return this.filterText ? this.appliesToFilter(bd) : dist < this.limit;
    });

    // sort the bds by distance from your location if using my location,
    // otherwise sort by time and then alphabetically
    if (this.userLocation) {
      nearby.sort((a, b) => a.milesFromMe - b.milesFromMe);
    } else {
      nearby.sort((a, b) => {
        // First compare by time
        const timeCompare = a.timeString.localeCompare(b.timeString);
        if (timeCompare !== 0) return timeCompare;
        // If times are equal, sort alphabetically by name
        return a.name.localeCompare(b.name);
      });
    }

    nearby.forEach(bd => {
      const bds = this.nearbyMap.get(bd.dayOfWeek) ?? [];
      bds.push(bd);
      regionSet.add(bd.region);
      this.nearbyMap.set(bd.dayOfWeek, bds);
    });

    // only show region info if there are multiple regions displayed
    this.showRegion = regionSet.size > 1;

    // now that we have the sorted filtered list we care about, build out
    // the schedule of days
    this.loadOneWeek();
  }

  /**
   * Load in 7 days at a time, can infinite scroll
   */
  loadOneWeek($event?: any) {
    // handle this being an ionic scroll event
    const ionicScrollEvent = $event as {target: {complete: Function}};

    // determine the day to start on
    const today = new Date();
    const todayDay = today.getDay();  // 4 = Wednesday
    let daysFromToday =
        this.days?.length ? this.days[this.days.length - 1].daysFromToday : 0;

    // if we're past noon, don't show today's BDs any longer
    if (today.getHours() >= 12) daysFromToday++;

    // load in the next 7 days
    for (let i = daysFromToday; i < daysFromToday + 7; i++) {
      // add on todayDay to ensure we're picking the correct day to display
      const dayOfWeek = DAYS[(todayDay + i) % 7];
      const beatdowns = this.nearbyMap.get(dayOfWeek) ?? [];

      // only build up days that have beatdowns
      if (beatdowns.length > 0) {
        const dateDisplay = this.getDateDisplay(today, i);
        this.days.push({daysFromToday: i, dateDisplay, beatdowns});
      }
    }

    // if this was an ionic scroll event, complete it
    if (ionicScrollEvent) ionicScrollEvent.target.complete();
  }

  /**
   * Get the distance in miles (as the crow flies) between two points
   */
  distance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    if ((lat1 == lat2) && (lon1 == lon2)) {
      return 0;
    } else {
      var radlat1 = Math.PI * lat1 / 180;
      var radlat2 = Math.PI * lat2 / 180;
      var theta = lon1 - lon2;
      var radtheta = Math.PI * theta / 180;
      var dist = Math.sin(radlat1) * Math.sin(radlat2) +
          Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
      if (dist > 1) {
        dist = 1;
      }
      dist = Math.acos(dist);
      dist = dist * 180 / Math.PI;
      dist = dist * 60 * 1.1515;
      return dist;
    }
  }

  /**
   * Return true if the provided beatdown applies to the filter
   */
  appliesToFilter(bd: Beatdown): boolean {
    const {name, address, region, notes, type} = bd;
    return [name, address, region, notes, type].some(field => {
      return field?.toLowerCase().includes(this.filterText?.toLowerCase());
    });
  }

  /**
   * Return a pretty string to represent the day offset from today
   */
  getDateDisplay(today: Date, offset: number) {
    if (offset === 0) return 'Today';
    if (offset === 1) return 'Tomorrow';
    if (offset < 7) {
      const day = DAYS[(today.getDay() + offset) % 7];
      return day.charAt(0).toUpperCase() + day.slice(1);
    }
    return this.addDays(today, offset).toDateString();
  }

  /**
   * Return a new date that is "days" days later
   */
  addDays(date: Date, days: number): Date {
    var result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  /**
   * Present a sheet to update the number of miles to filter to
   */
  async presentActionSheet() {
    // present the miles option in an action sheet
    const actionSheet = await this.actionSheetController.create({
      header: 'How many miles?',
      buttons: [
        ...MILES_OPTIONS.map(miles => {
          return {text: `${miles} miles`, role: `${miles}`};
        }),
        {text: 'Cancel', role: 'cancel'},
      ],
    });
    await actionSheet.present();

    // set the limit so long as cancel was not clicked
    const {role} = await actionSheet.onDidDismiss();
    if (!['backdrop', 'cancel'].includes(role)) {
      this.updateLimit(Number(role));
    }
  }

  /**
   * Save a given limit and re-load bds
   */
  updateLimit(limit: number) {
    this.limit = limit;
    localStorage.setItem('miles', `${limit}`);
    // Reload with new radius if we have location
    if (this.selectedLocation) {
      this.loadBeatdowns();
    } else {
      this.setNearbyBeatdowns();
    }
  }

  /**
   * Returns the last limit (from cache) or the default
   */
  loadLimit(): number {
    return Number(localStorage.getItem('miles') || DEFAULT_LIMIT);
  }

  /**
   * Persist the beatdown data to localStorage to recover later for a quick load
   * while we wait on the API
   */
  saveToCache() {
    try {
      localStorage.setItem('bds', JSON.stringify(this.allBDs || []));
    } catch (_e) {
      // Do nothing with the error for now, it's not a big deal that the data
      // doesn't get persisted
      localStorage.removeItem('bds');
    }
  }

  /**
   * Load the bds from cache and set up the rest of the app
   */
  loadFromCache() {
    this.allBDs = JSON.parse(localStorage.getItem('bds') || 'null');
  }

  /**
   * Returns the URL to a help article for enabling location services based on
   * the device's platform
   */
  private getLocationHelpLink(): string {
    if (this.platform.is('ios')) {
      return 'https://support.apple.com/en-us/HT207092';
    }
    if (this.platform.is('android')) {
      return 'https://support.google.com/android/answer/6179507?hl=en';
    }
    return 'https://docs.buddypunch.com/en/articles/919258-how-to-enable-location-services-for-chrome-safari-edge-and-android-ios-devices-gps-setting';
  }

  /**
   * Extract city and state/country from address, e.g. 'Boise, ID'
   */
  private extractCity(address: string | null | undefined): string {
    if (!address) return 'Unknown Location';
    
    // Split by comma and clean up the parts
    const parts = address
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0); // Remove empty parts
    
    if (parts.length >= 3) {
      // e.g. '123 Main St, Boise, ID, USA' or 'Boise, ID, USA'
      // Take the last two parts for city,state
      return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`;
    } else if (parts.length === 2) {
      // e.g. 'Boise, ID'
      return `${parts[0]}, ${parts[1]}`;
    } else if (parts.length === 1) {
      return parts[0];
    }
    return address;
  }

  /**
   * Normalize a string for deduplication (lowercase, trim, remove extra spaces)
   */
  private normalizeKey(str: string | null | undefined): string {
    return (str || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Extract unique regions and cities from beatdowns
   */
  private extractCities() {
    if (!this.allBDs) return;

    const cityMap = new Map<string, RegionCity>();
    const userLoc = this.userLocation;
    
    this.allBDs.forEach(bd => {
      const city = this.extractCity(bd.address);
      const region = bd.region || 'Unknown Region';
      const key = this.normalizeKey(city);
      
      if (!cityMap.has(key)) {
        cityMap.set(key, {
          city,
          regions: [region],
          lat: bd.lat,
          long: bd.long,
          distance: userLoc ? this.distance(
            bd.lat, 
            bd.long, 
            userLoc.latitude,
            userLoc.longitude
          ) : undefined,
        });
      } else {
        const cityData = cityMap.get(key);
        if (!cityData.regions.includes(region)) {
          cityData.regions.push(region);
        }
      }
    });

    this.cities = Array.from(cityMap.values())
      .sort((a, b) => {
        // Sort by distance, fall back to city name
        return (a.distance || 0) - (b.distance || 0) || a.city.localeCompare(b.city);
      });
    
    this.filteredCities = [...this.cities];
  }

  /**
   * Filter cities based on search text
   */
  filterCities(event: any) {
    const searchText = event.target.value.toLowerCase();
    this.citySearchText = searchText;
    
    if (!searchText) {
      this.filteredCities = [...this.cities];
      return;
    }

    // Check if the search text matches a state name
    const matchingStates = Object.entries(STATE_MAP).filter(([state, abbr]) => state.toLowerCase().includes(searchText) || abbr.toLowerCase().includes(searchText));

    this.filteredCities = this.cities.filter(rc => {
      // If searching for a state, check if the city's state matches
      if (matchingStates.length > 0) {
        const cityState = rc.city.split(',').pop()?.trim().toLowerCase();
        if (matchingStates.some(([state, abbr]) => cityState === state.toLowerCase() || cityState === abbr.toLowerCase())) {
          return true;
        }
      }
      
      // Otherwise do the normal city/region search
      return rc.city.toLowerCase().includes(searchText) || 
             rc.regions.some(r => r.toLowerCase().includes(searchText));
    });
  }

  /**
   * Handle city selection
   */
  selectCity(city: RegionCity) {
    this.selectedCity = city;
    this.selectedLocation = {
      latitude: city.lat,
      longitude: city.long
    };
    this.locationFailure = false;
    this.showRegionModal = false;
    // Reload beatdowns with geohash queries for the selected city
    this.loadBeatdowns();
  }

  /**
   * When user selects "My Location" from modal
   */
  selectMyLocation() {
    this.selectedCity = null;
    this.showRegionModal = false;
    
    // If we already have location, use it immediately
    if (this.myLocation) {
      this.selectedLocation = {
        latitude: this.myLocation.latitude,
        longitude: this.myLocation.longitude
      };
      // Reload beatdowns with geohash queries for my location
      this.loadBeatdowns();
      return;
    }
    
    // If we already know location access is denied, don't try again
    if (this.locationFailure) {
      return;
    }
    
    // Try to get location, which will call loadBeatdowns() when successful
    this.setMyLocation();
  }

  /**
   * For the "From" dropdown label
   */
  get fromLabel(): string {
    if (this.selectedCity) return `${this.selectedCity.city}`;
    if (this.userLocation && this.selectedLocation) return 'My Location';
    return 'Choose Location';
  }

  /**
   * Get the user's current location, preferring myLocation and falling back to ipLocation
   */
  get userLocation(): Coords | null {
    if (this.myLocation) {
      return this.myLocation;
    }
    if (this.ipLocation) {
      return {
        latitude: this.ipLocation.latitude,
        longitude: this.ipLocation.longitude
      };
    }
    return null;
  }

  /**
   * Show modal
   */
  openRegionModal() {
    this.showRegionModal = true;
    this.citySearchText = '';
    this.filteredCities = [...this.cities];
  }

  /**
   * Hide modal
   */
  closeRegionModal() {
    this.showRegionModal = false;
  }

  clearSearch() {
    this.filterText = '';
    this.setNearbyBeatdowns();
  }

  /**
   * Get a friendly message about the approximate location
   */
  get approximateLocationMessage(): string {
    if (!this.userLocation) return '';

    // if we have the user's location, just point them to nearby cities
    if (this.myLocation) {
      return `Here are some of the closest cities where you can find F3 workouts:`;
    }
    
    // if we don't have the user's location, use the IP location and tell them how we know
    let location = this.ipLocation.city;
    if (this.ipLocation.region && this.ipLocation.region !== location) {
      location = `${location}, ${this.ipLocation.region}`;
    } else if (this.ipLocation.country_name && this.ipLocation.country_name !== location) {
      location = `${location}, ${this.ipLocation.country_name}`;
    }
    return `Based on your IP address, you appear to be near ${location}. Here are some of the closest cities where you can find F3 workouts:`;
  }
}
