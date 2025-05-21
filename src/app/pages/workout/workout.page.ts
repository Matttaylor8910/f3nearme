import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BeatdownService } from '../../services/beatdown.service';
import { Beatdown } from '../nearby/nearby.page';
import { ToastController } from '@ionic/angular';

@Component({
  selector: 'app-workout',
  templateUrl: './workout.page.html',
  styleUrls: ['./workout.page.scss']
})
export class WorkoutPage implements OnInit {
  workout: Beatdown;
  relatedWorkouts: Beatdown[] = [];
  mapUrl: string;
  directionsUrl: string;
  loading = true;
  error = false;
  canShare = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private beatdownService: BeatdownService,
    private toastController: ToastController
  ) {
    // Check if Web Share API is available
    this.canShare = 'share' in navigator;
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error = true;
      this.loading = false;
      return;
    }

    this.beatdownService.getBeatdown(id).subscribe({
      next: (workout) => {
        this.workout = workout;
        this.mapUrl = `https://maps.google.com/maps?q=${workout.lat},${workout.long}&t=m&z=16&output=embed`;
        this.directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${workout.lat},${workout.long}`;
        this.loadRelatedWorkouts();
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading workout:', err);
        this.error = true;
        this.loading = false;
      }
    });
  }

  async shareWorkout() {
    const url = window.location.href;
    const title = `${this.workout.name} - ${this.workout.dayOfWeek} at ${this.workout.timeString}`;
    const text = `Check out this F3 workout: ${this.workout.name} at ${this.workout.address}`;

    if (this.canShare) {
      try {
        await navigator.share({
          title,
          text,
          url
        });
      } catch (err) {
        console.error('Error sharing:', err);
        this.copyToClipboard(url);
      }
    } else {
      this.copyToClipboard(url);
    }
  }

  private async copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      const toast = await this.toastController.create({
        message: 'Link copied to clipboard!',
        duration: 2000,
        position: 'bottom'
      });
      toast.present();
    } catch (err) {
      console.error('Error copying to clipboard:', err);
      const toast = await this.toastController.create({
        message: 'Failed to copy link',
        duration: 2000,
        position: 'bottom',
        color: 'danger'
      });
      toast.present();
    }
  }

  private loadRelatedWorkouts() {
    if (!this.workout) return;

    this.beatdownService.getBeatdownsByLatLong(this.workout.lat, this.workout.long).subscribe({
      next: (workouts) => {
        // Filter out the current workout and sort by day
        this.relatedWorkouts = workouts
          .filter(w => w.id !== this.workout.id)
          .sort((a, b) => {
            const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            return days.indexOf(a.dayOfWeek) - days.indexOf(b.dayOfWeek);
          });
      },
      error: (err) => {
        console.error('Error loading related workouts:', err);
      }
    });
  }

  openWebsite() {
    if (this.workout.website) {
      window.open(this.workout.website, '_blank');
    }
  }

  openDirections() {
    window.open(this.directionsUrl, '_blank');
  }

  openMap() {
    window.open(this.mapUrl, '_blank');
  }
} 