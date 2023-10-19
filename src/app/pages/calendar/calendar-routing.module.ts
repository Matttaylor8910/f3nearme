import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';

import {CalendarPage} from './calendar.page';

const routes: Routes = [{
  path: '',
  component: CalendarPage,
}];

@NgModule({imports: [RouterModule.forChild(routes)], exports: [RouterModule]})
export class CalendarPageRoutingModule {
}
