import {CommonModule} from '@angular/common';
import {NgModule} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {IonicModule} from '@ionic/angular';

import {PipesModule} from '../../pipes/pipes.module';

import {NearbyPageRoutingModule} from './nearby-routing.module';
import {NearbyPage} from './nearby.page';

@NgModule({
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    NearbyPageRoutingModule,
    PipesModule,
  ],
  declarations: [NearbyPage]
})
export class NearbyPageModule {
}
