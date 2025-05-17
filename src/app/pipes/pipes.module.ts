import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';

import {HighlightPipe} from './highlight.pipe';
import {SafePipe} from './safe.pipe';


@NgModule({
  imports: [
    CommonModule
  ],
  declarations: [
    HighlightPipe,
    SafePipe
  ],
  exports: [
    HighlightPipe,
    SafePipe
  ]
})
export class PipesModule {
}
