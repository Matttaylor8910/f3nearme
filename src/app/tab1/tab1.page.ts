import {Component} from '@angular/core';
import {ActionSheetController} from '@ionic/angular';

import {HttpService} from '../services/http.service';

const URL =
    'https://sheets.googleapis.com/v4/spreadsheets/1lfbDLW4aj_BJgEzX6A0AoTWb33BYIskko5ggjffOrrg/values/Points?key=AIzaSyCUFLnGh5pHkqh3TjPsJD-8hOZwGlxvRwQ';

interface Beatdown {
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

const BOISE_COORDS: Coords = {
  latitude: 43.6150,
  longitude: -116.2023,
};

const MILES_OPTIONS = [10, 20, 30, 50, 100];
const DEFAULT_LIMIT = 30;

const MIN_FILTER_TEXT_LENGTH = 3;

const DAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss']
})
export class Tab1Page {
  allBDs: Beatdown[];
  nearbyMap = new Map<string, Beatdown[]>;
  days: Day[];
  limit = this.loadLimit();
  showRegion = false;
  filterText: string;

  myLocation: Coords;
  locationFailure = false;

  constructor(
      private readonly http: HttpService,
      private readonly actionSheetController: ActionSheetController,
  ) {}

  ngOnInit() {
    this.loadFromCache();
    this.loadBeatdowns();
  }

  get title(): string {
    if (this.filterText) return 'Filtered Results';
    return this.locationFailure ? 'Near Boise, ID' : 'Nearby';
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
   * Load the beatdowns from the API
   */
  async loadBeatdowns() {
    const unparsed = await this.http.get(URL);

    this.allBDs = unparsed.values.map((bd, index) => {
      const [
        dayOfWeek,
        timeString,
        type,
        region,
        website,
        notes,
        _markerIcon,
        _markerColor,
        _iconColor,
        _customSize,
        name,
        _image,
        _description,
        address,
        lat,
        long,
      ] = bd;

      return {
        dayOfWeek,
        timeString,
        type,
        region,
        website,
        notes,
        name,
        address,
        lat: Number(lat),
        long: Number(long),
      };
    });

    // remove the first one (which is just labels)
    this.allBDs.shift();
    this.saveToCache();
    this.setMyLocation();
  }

  /**
   * Try to get the user's location, but fallback to Boise's coordinates for now
   */
  setMyLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
          this.onGeolocationSuccess.bind(this),
          this.onGeolocationFailure.bind(this));
    } else {
      this.onGeolocationFailure();
    }
  }

  /**
   * Handle successfully getting the user's location
   */
  onGeolocationSuccess(position: GeolocationPosition) {
    console.log(position);
    const {latitude, longitude} = position.coords;
    this.myLocation = {latitude, longitude};
    this.setNearbyBeatdowns();
  }

  /**
   * Handle being unable to load the user's location
   */
  onGeolocationFailure(failure?: GeolocationPositionError) {
    console.log(failure);
    this.locationFailure = true;
    this.myLocation = BOISE_COORDS;
    this.setNearbyBeatdowns();
  }

  /**
   * Filter down to the nearby beatdowns and set the data in the app
   * This will act as a reset as well
   */
  setNearbyBeatdowns() {
    // no-op if we're not ready
    if (!this.allBDs || !this.myLocation) return;

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
          this.myLocation.latitude,
          this.myLocation.longitude,
      );

      // side effect, but idc, we need the milesFromMe
      bd.milesFromMe = dist;

      return this.filterText ? this.appliesToFilter(bd) : dist < this.limit;
    });

    // sort the bds by distance from your location
    nearby.sort((a, b) => a.milesFromMe - b.milesFromMe);
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
    if (offset < 7) return DAYS[(today.getDay() + offset) % 7];
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
    if (role !== 'cancel') {
      this.updateLimit(Number(role));
    }
  }

  /**
   * Save a given limit and re-load bds
   */
  updateLimit(limit: number) {
    this.limit = limit;
    localStorage.setItem('miles', `${limit}`);
    this.setNearbyBeatdowns();
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
    localStorage.setItem('bds', JSON.stringify(this.allBDs || []));
  }

  /**
   * Load the bds from cache and set up the rest of the app
   */
  loadFromCache() {
    this.allBDs = JSON.parse(localStorage.getItem('bds') || 'null');
    this.setMyLocation();
  }
}
