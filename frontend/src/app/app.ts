import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppHeaderComponent } from './components/app-header';

@Component({
  imports: [RouterOutlet, AppHeaderComponent],
  selector: 'app-root',
  template: `
    <app-header />
    <router-outlet />
  `,
})
export class App {}
