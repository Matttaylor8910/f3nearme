import {Component} from '@angular/core';

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
}

interface Day {
  dateDisplay: string;
  beatdowns: Beatdown[];
}

interface Coords {
  latitude: number;
  longitude: number;
}

const BOISE_COORDS: Coords = {
  latitude: 43.6150,
  longitude: -116.2023,
};

const MAX_MILES = 25;

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss']
})
export class Tab1Page {
  allBDs: Beatdown[];
  nearby: Beatdown[];
  myLocation: Coords;

  constructor(
      private readonly http: HttpService,
  ) {}

  ngOnInit() {
    this.loadBeatdowns();
  }

  async loadBeatdowns() {
    this.loadFromCache();
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
    const {latitude, longitude} = position.coords;
    this.myLocation = {latitude, longitude};
    this.setNearbyBeatdowns();
  }

  /**
   * Handle being unable to load the user's location
   */
  onGeolocationFailure(failure?: GeolocationPositionError) {
    this.myLocation = BOISE_COORDS;
    console.log(failure);
    this.setNearbyBeatdowns();
  }

  /**
   * Filter down to the nearby beatdowns
   */
  setNearbyBeatdowns() {
    this.nearby = this.allBDs.filter(bd => {
      const dist = this.distance(
          bd.lat,
          bd.long,
          this.myLocation.latitude,
          this.myLocation.longitude,
      );
      return dist < MAX_MILES;
    });
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
