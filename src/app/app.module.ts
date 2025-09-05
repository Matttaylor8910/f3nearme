import {HttpClientModule} from '@angular/common/http';
import {NgModule} from '@angular/core';
import {ScreenTrackingService, UserTrackingService} from '@angular/fire/analytics';
import {AngularFireModule} from '@angular/fire/compat';
import {AngularFireAnalyticsModule} from '@angular/fire/compat/analytics';
import {AngularFireFunctionsModule} from '@angular/fire/compat/functions';
import {BrowserModule} from '@angular/platform-browser';
import {RouteReuseStrategy} from '@angular/router';
import {IonicModule, IonicRouteStrategy} from '@ionic/angular';
import {environment} from 'src/environments/environment';

import {AppRoutingModule} from './app-routing.module';
import {AppComponent} from './app.component';

@NgModule({
  declarations: [
    AppComponent,
  ],
  imports: [
    BrowserModule,
    IonicModule.forRoot(),
    AppRoutingModule,
    HttpClientModule,
    AngularFireModule.initializeApp(environment.firebase),
    AngularFireAnalyticsModule,
    AngularFireFunctionsModule,
  ],
  providers: [
    ScreenTrackingService,
    UserTrackingService,
    {provide: RouteReuseStrategy, useClass: IonicRouteStrategy},
  ],
  bootstrap: [
    AppComponent,
  ],
})
export class AppModule {
}
