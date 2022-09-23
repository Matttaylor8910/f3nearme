import {HttpClientModule} from '@angular/common/http';
import {NgModule} from '@angular/core';
import {AnalyticsModule, ScreenTrackingService, UserTrackingService} from '@angular/fire/analytics';
import {BrowserModule} from '@angular/platform-browser';
import {RouteReuseStrategy} from '@angular/router';
import {IonicModule, IonicRouteStrategy} from '@ionic/angular';

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
    AnalyticsModule,
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
