import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgOptimizedImage } from '@angular/common';
import { Icon } from '../../shared/ui/icon';

@Component({
  selector: 'app-landing-page',
  imports: [RouterLink, Icon, NgOptimizedImage],
  templateUrl: './landing-page.html',
  styleUrl: './landing-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingPage {
  readonly crops = [
    { name: 'Paddy', bangla: 'Dhan' },
    { name: 'Jute', bangla: 'Pat' },
    { name: 'Potato', bangla: 'Alu' },
    { name: 'Mustard', bangla: 'Sarisha' },
  ];
}
