import {NgModule} from '@angular/core';
import {PreloadAllModules, RouterModule, Routes} from '@angular/router';

const routes: Routes = [
  {
    path: '',
    redirectTo: '/nearby',
    pathMatch: 'full',
  },
  {
    path: 'nearby',
    loadChildren: () =>
        import('./pages/nearby/nearby.module').then(m => m.NearbyPageModule),
  },
];
@NgModule({
  imports:
      [RouterModule.forRoot(routes, {preloadingStrategy: PreloadAllModules})],
  exports: [RouterModule]
})
export class AppRoutingModule {
}
