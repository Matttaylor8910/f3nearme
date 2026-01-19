// This file can be replaced during build by using the `fileReplacements` array.
// `ng build --prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  firebase: {
    apiKey: 'AIzaSyDEBCQE3u4Wq_L2CVmZWNsGmpLJO_rap4s',
    authDomain: 'f3-workout.firebaseapp.com',
    projectId: 'f3-workout',
    storageBucket: 'f3-workout.appspot.com',
    messagingSenderId: '357811788369',
    appId: '1:357811788369:web:139530a2af2a34cd047670',
    measurementId: 'G-K1KK3EEV9H',
  },
  // Base URL for JSON data files served from Cloud Storage
  dataUrl: 'https://storage.googleapis.com/f3-workout.appspot.com/data'
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`,
 * `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a
 * negative impact on performance if an error is thrown.
 */
// import 'zone.js/dist/zone-error';  // Included with Angular CLI.
