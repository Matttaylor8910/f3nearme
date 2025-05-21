import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { WorkoutPageRoutingModule } from './workout-routing.module';
import { WorkoutPage } from './workout.page';
import { PipesModule } from '../../pipes/pipes.module';
import { LinkifyPipe } from '../../pipes/linkify.pipe';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    WorkoutPageRoutingModule,
    PipesModule
  ],
  declarations: [
    WorkoutPage,
    LinkifyPipe
  ]
})
export class WorkoutPageModule {} 