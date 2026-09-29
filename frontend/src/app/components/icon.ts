import { Component, input } from '@angular/core';

/**
 * Icônes au trait, dans la couleur du texte. Remplacent les émojis de
 * l'ancienne interface, dont le rendu change d'un système à l'autre.
 * Décoratives par défaut : un bouton qui n'affiche qu'une icône porte
 * lui-même son `aria-label`.
 */
@Component({
  selector: 'app-icon',
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 20 20" fill="none"
      stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true" class="shrink-0">
      @switch (name()) {
        @case ('check') { <path d="M4.5 10.5l3.5 3.5 7.5-8" /> }
        @case ('download') { <path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12" /> }
        @case ('trash') { <path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10h7.4l.8-10" /> }
        @case ('scissors') { <circle cx="5.5" cy="6" r="2.2" /><circle cx="5.5" cy="14" r="2.2" /><path d="M7.4 7.2L16 14M7.4 12.8L16 6" /> }
        @case ('play') { <path d="M6.5 4.5v11l9-5.5z" fill="currentColor" stroke="none" /> }
        @case ('chevron-right') { <path d="M8 5l5 5-5 5" /> }
        @case ('arrow-left') { <path d="M11 5L6 10l5 5M6 10h9" /> }
        @case ('youtube') { <rect x="2.5" y="4.5" width="15" height="11" rx="3" /><path d="M8.5 7.8v4.4l3.7-2.2z" fill="currentColor" stroke="none" /> }
        @case ('alert') { <circle cx="10" cy="10" r="7.25" /><path d="M10 6v4.5M10 13.4v.1" /> }
        @case ('clock') { <circle cx="10" cy="10" r="7.25" /><path d="M10 5.5V10l3 2" /> }
        @case ('pin') { <path d="M10 17s5-4.6 5-8.5a5 5 0 00-10 0C5 12.4 10 17 10 17z" /><circle cx="10" cy="8.5" r="1.8" /> }
        @case ('refresh') { <path d="M15.5 8A6 6 0 004.6 6.5M4.5 12a6 6 0 0010.9 1.5M4.5 3.5v3h3M15.5 16.5v-3h-3" /> }
        @case ('plus') { <path d="M10 4v12M4 10h12" /> }
        @case ('x') { <path d="M5 5l10 10M15 5L5 15" /> }
        @case ('target') { <circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3" /> }
        @case ('list') { <path d="M4 5.5h9M4 10h9M4 14.5h6M15 12.5l3 2-3 2z" /> }
        @case ('external') { <path d="M11 4h5v5M16 4l-7 7M14 11.5V16H4V6h4.5" /> }
        @case ('link') { <path d="M8.5 11.5l3-3M7 9.5l-1.5 1.5a2.8 2.8 0 004 4L11 13.5M13 10.5l1.5-1.5a2.8 2.8 0 00-4-4L9 6.5" /> }
        @case ('archive') { <rect x="3" y="4" width="14" height="4" rx="1" /><path d="M4.5 8v7.5h11V8M8 11h4" /> }
        @case ('wand') { <path d="M4 16L13.5 6.5M12 4.5l3.5 3.5M15.5 2.5v2M14.5 3.5h2M5 3v2M4 4h2" /> }
      }
    </svg>
  `,
})
export class IconComponent {
  name = input.required<string>();
  size = input(18);
}
